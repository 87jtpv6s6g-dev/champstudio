/**
 * Verifica automatica di fine build:
 *  - apre la replica con la RETE ESTERNA BLOCCATA (tutto ciò che non è la replica
 *    stessa viene abortito) e conta le richieste fallite e gli errori JS NUOVI rispetto
 *    all'originale;
 *  - confronta gli screenshot desktop e mobile con l'originale (pixelmatch).
 * Esito: pronta / da-rivedere / fallita, con immagini di differenza.
 */
import fs from "node:fs";
import path from "node:path";
import { devices, type Browser } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { launchChromium } from "../capture/browser.js";
import { artifactDir, ARTIFACTS_DIR } from "../config.js";
import type { VerifyResult, Verdict } from "../types.js";

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = devices["iPhone 13"];

function normalizeError(msg: string): string {
  return msg
    .replace(/https?:\/\/[^\s)]+/g, "<url>")
    .replace(/:\d+:\d+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

interface PageProbe {
  errors: Set<string>;
  failed: number;
  desktop: Buffer;
  mobile: Buffer;
}

async function probe(
  browser: Browser,
  url: string,
  opts: { block: boolean },
): Promise<PageProbe> {
  const errors = new Set<string>();
  let failed = 0;

  const replicaHost = new URL(url).host;

  async function shot(device: "desktop" | "mobile"): Promise<Buffer> {
    const ctx = await browser.newContext(
      device === "desktop"
        ? { viewport: DESKTOP }
        : { ...MOBILE },
    );
    if (opts.block) {
      await ctx.route("**/*", (route) => {
        try {
          const u = new URL(route.request().url());
          if (u.protocol !== "http:" && u.protocol !== "https:") return route.continue();
          if (u.host === replicaHost) return route.continue();
          return route.abort();
        } catch {
          return route.continue();
        }
      });
    }
    // Non registrare la sessione durante la verifica.
    await ctx.addInitScript(() => {
      (window as any).__REPLICA_NOREC__ = true;
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.add(normalizeError(String(e.message || e))));
    page.on("console", (m) => {
      if (m.type() === "error") errors.add(normalizeError(m.text()));
    });
    page.on("requestfailed", () => {
      failed++;
    });
    page.on("response", (r) => {
      if (r.status() >= 400) failed++;
    });
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(600);
    } catch {
      /* ignore */
    }
    const buf = await page.screenshot({ fullPage: false });
    await ctx.close();
    return buf;
  }

  const desktop = await shot("desktop");
  const mobile = await shot("mobile");
  return { errors, failed, desktop, mobile };
}

function diffImages(
  aBuf: Buffer,
  bBuf: Buffer,
  outPath: string,
): number {
  const a = PNG.sync.read(aBuf);
  const b = PNG.sync.read(bBuf);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  if (width === 0 || height === 0) return 100;
  const ca = cropTo(a, width, height);
  const cb = cropTo(b, width, height);
  const diff = new PNG({ width, height });
  const mismatch = pixelmatch(ca.data, cb.data, diff.data, width, height, {
    threshold: 0.1,
  });
  fs.writeFileSync(outPath, PNG.sync.write(diff));
  const pct = (mismatch / (width * height)) * 100;
  return Math.round(pct * 100) / 100;
}

function cropTo(img: PNG, w: number, h: number): PNG {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (img.width * y + x) << 2;
      const di = (w * y + x) << 2;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

export interface VerifyInput {
  buildId: string;
  originUrl: string;
  replicaUrl: string;
}

export async function verifyReplica(input: VerifyInput): Promise<VerifyResult> {
  const dir = artifactDir(input.buildId);
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launchChromium();
  const details: string[] = [];
  try {
    const origin = await probe(browser, input.originUrl, { block: false });
    const replica = await probe(browser, input.replicaUrl, { block: true });

    // screenshot salvati
    fs.writeFileSync(path.join(dir, "origin-desktop.png"), origin.desktop);
    fs.writeFileSync(path.join(dir, "replica-desktop.png"), replica.desktop);
    fs.writeFileSync(path.join(dir, "origin-mobile.png"), origin.mobile);
    fs.writeFileSync(path.join(dir, "replica-mobile.png"), replica.mobile);

    const desktopDiffPct = diffImages(
      origin.desktop,
      replica.desktop,
      path.join(dir, "diff-desktop.png"),
    );
    const mobileDiffPct = diffImages(
      origin.mobile,
      replica.mobile,
      path.join(dir, "diff-mobile.png"),
    );

    const newJsErrors = [...replica.errors].filter((e) => !origin.errors.has(e));
    const failedRequests = replica.failed;

    details.push(`Richieste fallite (rete esterna bloccata): ${failedRequests}`);
    details.push(
      `Errori JS nuovi: ${newJsErrors.length}${newJsErrors.length ? " → " + newJsErrors.slice(0, 5).join(" | ") : ""}`,
    );
    details.push(`Diff screenshot desktop: ${desktopDiffPct}%`);
    details.push(`Diff screenshot mobile: ${mobileDiffPct}%`);

    let verdict: Verdict;
    const diffOk = desktopDiffPct <= 1 && mobileDiffPct <= 1;
    if (failedRequests > 0 || desktopDiffPct > 5 || mobileDiffPct > 5) {
      verdict = "fallita";
    } else if (newJsErrors.length > 0 || !diffOk) {
      verdict = "da-rivedere";
    } else {
      verdict = "pronta";
    }

    const rel = (f: string) => path.relative(ARTIFACTS_DIR, path.join(dir, f));
    return {
      verdict,
      failedRequests,
      newJsErrors: newJsErrors.length,
      desktopDiffPct,
      mobileDiffPct,
      details,
      images: [
        { label: "diff desktop", path: rel("diff-desktop.png") },
        { label: "diff mobile", path: rel("diff-mobile.png") },
      ],
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
