/**
 * Cattura con browser reale (Playwright).
 *  - DISCOVERY: naviga le pagine (link interni + sitemap.xml), scrolla per il lazy
 *    loading, clicca tab/menu/pulsanti sicuri per far caricare i chunk e scoprire le
 *    schermate nascoste (es. login via pushState). MAI invia form, MAI logout/paga/
 *    elimina. Raccoglie tutti gli URL richiesti e le route.
 *  - DOWNLOAD: scarica ogni risorsa con context.request.get (niente Range → audio/video
 *    interi; redirect seguiti fino alla risposta finale; nessun "body non disponibile").
 *  - FIXPOINT: analizza JS/CSS/HTML scaricati per trovare dipendenze mancanti e ripete.
 */
import { devices, type BrowserContext, type Page } from "playwright";
import { launchChromium } from "./browser.js";
import { tryUrl, isHttp } from "./urls.js";
import { extractFromJs, extractFromCss, extractFromHtml } from "./resolver.js";

export interface CapturedResource {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
}

export interface CaptureResult {
  origin: string;
  host: string;
  entryUrl: string;
  resources: Map<string, CapturedResource>;
  pages: string[];
  routes: string[];
}

export interface CaptureOptions {
  maxPages?: number;
  maxResources?: number;
  navTimeout?: number;
}

type Progress = (
  phase: string,
  message: string,
  level?: "info" | "warn" | "error" | "success",
) => void;

const TRACKER = [
  "/cdn-cgi/challenge-platform",
  "google-analytics.com",
  "googletagmanager.com",
  "connect.facebook.net",
  "static.hotjar.com",
  "cdn.segment.com",
  "doubleclick.net",
  "clarity.ms",
];
const isTracker = (u: string) => TRACKER.some((t) => u.toLowerCase().includes(t));

const DANGER = "logout|log out|esci|sign ?out|elimina|delete|rimuovi|cancella|paga|pay|checkout|acquista|buy|ordina|place order|conferma ordine";

function stripHash(u: string): string {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.toString();
  } catch {
    return u;
  }
}

async function autoScroll(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let y = 0;
        const step = 400;
        const timer = setInterval(() => {
          const h = document.body ? document.body.scrollHeight : 0;
          window.scrollBy(0, step);
          y += step;
          if (y >= h) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 60);
      });
    });
  } catch {
    /* ignore */
  }
}

async function clickToReveal(page: Page): Promise<string[]> {
  try {
    const routes = await page.evaluate((dangerSrc) => {
      const danger = new RegExp(dangerSrc, "i");
      const seen: string[] = [];
      const sel = "button,[role=button],[role=tab],[data-toggle],[data-bs-toggle],summary,[aria-haspopup]";
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      for (const el of els.slice(0, 20)) {
        if (el.closest("form")) continue;
        if ((el as HTMLButtonElement).type === "submit") continue;
        const t = (el.textContent || "").trim().toLowerCase();
        if (danger.test(t)) continue;
        try {
          el.click();
          seen.push(location.pathname + location.search);
        } catch (e) {
          /* ignore */
        }
      }
      return Array.from(new Set(seen));
    }, DANGER);
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    return routes;
  } catch {
    return [];
  }
}

export async function runCapture(
  entryUrl: string,
  opts: CaptureOptions,
  progress: Progress,
): Promise<CaptureResult> {
  const maxPages = opts.maxPages ?? 25;
  const maxResources = opts.maxResources ?? 1500;
  const navTimeout = opts.navTimeout ?? 30000;

  const entry = new URL(entryUrl);
  const origin = entry.origin;
  const host = entry.host;

  const resourceUrls = new Set<string>();
  const pages = new Set<string>([stripHash(entry.toString())]);
  const routes = new Set<string>();

  const browser = await launchChromium();

  const sameOrigin = (u: string) => {
    const p = tryUrl(u);
    return !!p && p.origin === origin;
  };

  const attach = (page: Page) => {
    page.on("request", (req) => {
      const u = req.url();
      if (/^https?:/.test(u) && !isTracker(u)) resourceUrls.add(stripHash(u));
    });
    page.on("response", (resp) => {
      const u = resp.url();
      if (/^https?:/.test(u) && !isTracker(u)) resourceUrls.add(stripHash(u));
    });
  };

  async function discover(context: BrowserContext, deep: boolean) {
    const page = await context.newPage();
    attach(page);
    const queue = [...pages];
    let count = 0;
    while (queue.length && count < maxPages) {
      const url = queue.shift()!;
      count++;
      try {
        progress("cattura", `Pagina: ${url}`);
        await page.goto(url, { waitUntil: "load", timeout: navTimeout });
        await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
        await autoScroll(page);
        if (deep) {
          const r = await clickToReveal(page);
          for (const rt of r) {
            const abs = tryUrl(rt, origin);
            if (abs) routes.add(abs.toString());
          }
          await autoScroll(page);
        }
        // raccogli link interni
        const hrefs: string[] = await page
          .$$eval("a[href]", (els) => els.map((e) => (e as HTMLAnchorElement).href))
          .catch(() => []);
        for (const h of hrefs) {
          const s = stripHash(h);
          if (sameOrigin(s) && !pages.has(s) && pages.size < maxPages) {
            pages.add(s);
            if (deep) queue.push(s);
          }
        }
      } catch (e: any) {
        progress("cattura", `Navigazione fallita ${url}: ${e?.message ?? e}`, "warn");
      }
    }
    await page.close().catch(() => {});
  }

  // sitemap.xml
  const desktopCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  });
  try {
    const sm = await desktopCtx.request.get(origin + "/sitemap.xml", { timeout: 8000 });
    if (sm.ok()) {
      const xml = await sm.text();
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const s = stripHash(m[1]);
        if (sameOrigin(s) && pages.size < maxPages) pages.add(s);
      }
      progress("cattura", `sitemap.xml: ${pages.size} pagine note`);
    }
  } catch {
    /* nessuna sitemap */
  }

  progress("cattura", "Discovery desktop…");
  await discover(desktopCtx, true);

  progress("cattura", "Discovery mobile…");
  const mobileCtx = await browser.newContext({ ...devices["iPhone 13"] });
  await discover(mobileCtx, false);

  progress("cattura", `Pagine: ${pages.size}, URL richiesti: ${resourceUrls.size}`);

  // DOWNLOAD + FIXPOINT
  progress("download", "Scarico le risorse…");
  const resources = new Map<string, CapturedResource>();
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const u of [...pages, ...resourceUrls]) {
    if (!seen.has(u)) {
      seen.add(u);
      queue.push(u);
    }
  }

  const reqCtx = desktopCtx.request;

  async function download(url: string): Promise<CapturedResource | null> {
    try {
      const resp = await reqCtx.get(url, { timeout: navTimeout, maxRedirects: 10 });
      const status = resp.status();
      const headers = resp.headers();
      const ct = headers["content-type"] || "";
      const body = Buffer.from(await resp.body());
      return { url, finalUrl: resp.url(), status, contentType: ct, body };
    } catch (e: any) {
      progress("download", `Download fallito ${url}: ${e?.message ?? e}`, "warn");
      return null;
    }
  }

  const isJs = (ct: string, u: string) => /javascript|ecmascript/.test(ct) || /\.(m?js)(\?|$)/i.test(u);
  const isCss = (ct: string, u: string) => /text\/css/.test(ct) || /\.css(\?|$)/i.test(u);
  const isHtml = (ct: string) => /text\/html|application\/xhtml/.test(ct);

  let downloaded = 0;
  while (queue.length && resources.size < maxResources) {
    const batch = queue.splice(0, 8);
    const got = await Promise.all(batch.map(download));
    for (let i = 0; i < got.length; i++) {
      const r = got[i];
      const reqUrl = batch[i];
      if (!r) continue;
      if (isTracker(reqUrl)) continue;
      resources.set(reqUrl, r);
      downloaded++;
      if (downloaded % 10 === 0) progress("download", `${downloaded} risorse scaricate…`);

      // fixpoint: analizza solo bodies utili ed espandi
      const canParse = sameOrigin(reqUrl) || isJs(r.contentType, reqUrl) || isCss(r.contentType, reqUrl);
      if (!canParse) continue;
      const text = r.body.toString("utf8");
      let refs: string[] = [];
      try {
        if (isJs(r.contentType, reqUrl)) refs = await extractFromJs(text, r.finalUrl);
        else if (isCss(r.contentType, reqUrl)) refs = extractFromCss(text, r.finalUrl);
        else if (isHtml(r.contentType)) refs = extractFromHtml(text, r.finalUrl);
      } catch {
        refs = [];
      }
      for (const ref of refs) {
        const u = tryUrl(ref);
        if (!u || !isHttp(u) || isTracker(ref)) continue;
        const key = stripHash(u.toString());
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(key);
        }
      }
    }
  }
  progress("download", `Totale risorse: ${resources.size}`, "success");

  await browser.close().catch(() => {});

  return {
    origin,
    host,
    entryUrl: entry.toString(),
    resources,
    pages: [...pages],
    routes: [...routes],
  };
}
