/**
 * Orchestratore di una build: cattura → salvataggio su disco (percorsi originali
 * conservati) → riscrittura (neutralizzazione origine + iniezione) → manifest + meta.
 */
import fs from "node:fs";
import path from "node:path";
import { replicaDir } from "../config.js";
import { builds } from "../db/index.js";
import { bus } from "../bus.js";
import { runCapture, type CaptureResult } from "./crawler.js";
import { localPathFor, pageLocalPath, tryUrl } from "./urls.js";
import { rewriteHtml, rewriteCss, rewriteJs } from "./rewriter.js";

export interface ReplicaMeta {
  buildId: string;
  origin: string;
  entryUrl: string;
  entryPath: string;
  paths: Record<string, { contentType: string }>;
  manifest: string[];
  pages: string[];
  routes: string[];
}

function siteDir(buildId: string): string {
  return path.join(replicaDir(buildId), "site");
}
function metaPath(buildId: string): string {
  return path.join(replicaDir(buildId), "meta.json");
}

/** Scrive un file sotto site/ impedendo path traversal. */
function writeSiteFile(buildId: string, rel: string, body: Buffer): string | null {
  const root = siteDir(buildId);
  const dest = path.resolve(root, "." + (rel.startsWith("/") ? rel : "/" + rel));
  if (dest !== root && !dest.startsWith(root + path.sep)) return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body);
  return dest;
}

const isJs = (ct: string, u: string) => /javascript|ecmascript/.test(ct) || /\.(m?js)(\?|$)/i.test(u);
const isCss = (ct: string, u: string) => /text\/css/.test(ct) || /\.css(\?|$)/i.test(u);
const isHtml = (ct: string) => /text\/html|application\/xhtml/.test(ct);

export function loadMeta(buildId: string): ReplicaMeta {
  return JSON.parse(fs.readFileSync(metaPath(buildId), "utf8"));
}

export async function captureAndBuild(buildId: string, entryUrl: string): Promise<ReplicaMeta> {
  const progress = (phase: string, message: string, level: any = "info") => {
    builds.log(buildId, phase, level, message);
    bus.emitEvent({ kind: "build", buildId, data: { phase, message, level, ts: Date.now() } });
  };

  builds.setStatus(buildId, "capturing");
  const result: CaptureResult = await runCapture(entryUrl, {}, progress);

  const { origin } = result;
  const captured = new Set<string>([...result.resources.keys()]);

  // 1) salva tutti i file (percorsi originali conservati)
  builds.setStatus(buildId, "rewriting");
  progress("salvataggio", "Salvo i file catturati…");
  const paths: Record<string, { contentType: string }> = {};
  let bytes = 0;
  const pathToResourceKey = new Map<string, string>();

  for (const [key, res] of result.resources) {
    if (res.status >= 400) continue;
    const u = tryUrl(res.url);
    if (!u) continue;
    const rel = localPathFor(u, origin, res.contentType);
    const written = writeSiteFile(buildId, rel, res.body);
    if (!written) continue;
    paths[rel] = { contentType: res.contentType };
    pathToResourceKey.set(rel, key);
    bytes += res.body.length;
  }

  // 2) riscrittura dei file testuali (html/css/js)
  progress("riscrittura", "Neutralizzo l'origine e inietto isolamento + rrweb…");
  let rewritten = 0;
  for (const rel of Object.keys(paths)) {
    const key = pathToResourceKey.get(rel)!;
    const res = result.resources.get(key)!;
    const ct = res.contentType;
    const abs = res.url;
    const dest = path.resolve(siteDir(buildId), "." + rel);
    try {
      if (isHtml(ct) || rel.endsWith(".html")) {
        const html = fs.readFileSync(dest, "utf8");
        fs.writeFileSync(dest, rewriteHtml(html, abs, origin, captured));
        rewritten++;
      } else if (isCss(ct, abs) || rel.endsWith(".css")) {
        const css = fs.readFileSync(dest, "utf8");
        fs.writeFileSync(dest, rewriteCss(css, abs, origin, captured));
        rewritten++;
      } else if (isJs(ct, abs)) {
        const js = fs.readFileSync(dest, "utf8");
        fs.writeFileSync(dest, rewriteJs(js, origin));
        rewritten++;
      }
    } catch (e: any) {
      progress("riscrittura", `Riscrittura saltata ${rel}: ${e?.message ?? e}`, "warn");
    }
  }
  progress("riscrittura", `File riscritti: ${rewritten}`, "success");

  // 3) entry path + manifest + meta
  const entryU = new URL(result.entryUrl);
  let entryPath = pageLocalPath(entryU, origin);
  if (!paths[entryPath]) {
    // fallback: la prima pagina HTML catturata
    const firstHtml = Object.keys(paths).find(
      (p) => p.endsWith(".html") && paths[p].contentType.includes("html"),
    );
    if (firstHtml) entryPath = firstHtml;
  }

  const meta: ReplicaMeta = {
    buildId,
    origin,
    entryUrl: result.entryUrl,
    entryPath,
    paths,
    manifest: Object.keys(paths),
    pages: result.pages,
    routes: result.routes,
  };
  fs.mkdirSync(replicaDir(buildId), { recursive: true });
  fs.writeFileSync(metaPath(buildId), JSON.stringify(meta, null, 2));

  builds.mergeStats(buildId, {
    pages: result.pages.length,
    assets: Object.keys(paths).length,
    bytes,
  });
  progress(
    "riscrittura",
    `Pagine ${result.pages.length} · risorse ${Object.keys(paths).length} · ${(bytes / 1024).toFixed(0)} KB`,
    "success",
  );

  return meta;
}
