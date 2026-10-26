import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Sorgenti browser statici (serviti sotto /__mirror/). */
export const isolationJs = fs.readFileSync(path.join(here, "isolation.js"), "utf8");
export const recordJs = fs.readFileSync(path.join(here, "record.js"), "utf8");

/** Bundle UMD di rrweb per la registrazione (global window.rrweb).
 * Il campo "exports" di rrweb non espone le sottocartelle dist/, quindi risolviamo
 * l'entry principale e leggiamo il bundle UMD minificato dalla stessa cartella. */
const rrwebDistDir = path.dirname(require.resolve("rrweb"));
export const rrwebBundlePath = path.join(rrwebDistDir, "rrweb.umd.min.cjs");
export const rrwebJs = fs.readFileSync(rrwebBundlePath, "utf8");

/** Percorsi virtuali serviti dal replica server. */
export const MIRROR = {
  manifest: "/__mirror/manifest.js",
  isolation: "/__mirror/isolation.js",
  rrweb: "/__mirror/rrweb.js",
  record: "/__mirror/record.js",
  rec: "/__mirror/rec",
};

/**
 * Tag da iniettare all'INIZIO del <head> (manifest + isolamento, script classici
 * parser-blocking → eseguiti prima dei moduli differiti del sito) e i tag del
 * recorder. La rewriter li inserisce via parse5.
 */
export function headInjectionTags(): { first: string[]; recorder: string[] } {
  return {
    first: [
      `<script src="${MIRROR.manifest}"></script>`,
      `<script src="${MIRROR.isolation}"></script>`,
    ],
    recorder: [
      `<script src="${MIRROR.rrweb}"></script>`,
      `<script src="${MIRROR.record}"></script>`,
    ],
  };
}

/** Marcatore per riconoscere pagine già processate dalla rewriter. */
export const INJECT_MARKER = "data-replica-injected";

export { pathToFileURL };
