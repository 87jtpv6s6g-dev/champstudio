/**
 * Estrae gli URL referenziati dai file catturati, così da scoprire le dipendenze
 * mancanti e scaricarle. JS → es-module-lexer (+ import dinamici e __vite__mapDeps),
 * CSS → PostCSS (url() e @import), HTML → parse5 (src, srcset, href, ...).
 */
import { init, parse as lexJs } from "es-module-lexer";
import postcss from "postcss";
import { parse as parseHtml, parseFragment } from "parse5";
import { tryUrl, isHttp } from "./urls.js";

let lexerReady: Promise<void> | null = null;
export async function ensureLexer(): Promise<void> {
  if (!lexerReady) lexerReady = init as unknown as Promise<void>;
  await lexerReady;
}

function resolveAll(specs: string[], baseUrl: string): string[] {
  const out = new Set<string>();
  for (const s of specs) {
    if (!s) continue;
    const t = s.trim();
    if (!t || t.startsWith("data:") || t.startsWith("blob:")) continue;
    if (/^(mailto:|tel:|javascript:|#)/i.test(t)) continue;
    const u = tryUrl(t, baseUrl);
    if (u && isHttp(u)) out.add(u.toString());
  }
  return [...out];
}

export async function extractFromJs(code: string, baseUrl: string): Promise<string[]> {
  const specs: string[] = [];
  try {
    await ensureLexer();
    const [imports] = lexJs(code);
    for (const imp of imports as any[]) {
      if (imp.n) specs.push(imp.n); // import statico/dinamico con specifier stringa
    }
  } catch {
    // file non-ESM o non parsabile: si prosegue con le euristiche sotto
  }
  // __vite__mapDeps([...]) e array di chunk: raccogli stringhe tipo percorso
  const mapDeps = code.match(/__vite__mapDeps\s*\(\s*\[([\s\S]*?)\]/);
  if (mapDeps) {
    for (const m of mapDeps[1].matchAll(/["'`]([^"'`]+\.(?:js|mjs|css))["'`]/g)) {
      specs.push(m[1]);
    }
  }
  // new URL("....", import.meta.url)
  for (const m of code.matchAll(/new\s+URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url\s*\)/g)) {
    specs.push(m[1]);
  }
  // asset referenziati come stringhe relative/assolute con estensione nota
  for (const m of code.matchAll(
    /["'`]((?:\.{0,2}\/|https?:\/\/)[^"'`\s]+?\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|mp3|mp4|webm|ogg|wav|json))(?:\?[^"'`]*)?["'`]/gi,
  )) {
    specs.push(m[1]);
  }
  return resolveAll(specs, baseUrl);
}

export function extractFromCss(code: string, baseUrl: string): string[] {
  const specs: string[] = [];
  try {
    const root = postcss.parse(code);
    root.walkDecls((decl) => {
      for (const m of decl.value.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
        specs.push(m[2]);
      }
    });
    root.walkAtRules("import", (rule) => {
      const m = rule.params.match(/(['"])([^'"]+)\1|url\(\s*(['"]?)([^'")]+)\3\s*\)/);
      if (m) specs.push(m[2] || m[4] || "");
    });
  } catch {
    // CSS non parsabile: fallback regex su url()
    for (const m of code.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) specs.push(m[2]);
  }
  return resolveAll(specs, baseUrl);
}

type P5Node = {
  tagName?: string;
  nodeName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5Node[];
  value?: string;
};

function splitSrcset(v: string): string[] {
  return v
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

const URL_ATTRS = new Set(["src", "href", "poster", "data-src", "data-href"]);

export function extractFromHtml(html: string, baseUrl: string): string[] {
  const specs: string[] = [];
  let doc: P5Node;
  try {
    doc = parseHtml(html) as unknown as P5Node;
  } catch {
    return [];
  }
  const walk = (node: P5Node) => {
    if (!node) return;
    const tag = node.tagName;
    if (node.attrs) {
      for (const a of node.attrs) {
        const name = a.name.toLowerCase();
        if (URL_ATTRS.has(name)) specs.push(a.value);
        if (name === "srcset") specs.push(...splitSrcset(a.value));
        if (name === "style") specs.push(...extractFromCssInline(a.value, baseUrl));
      }
    }
    if (tag === "style" && node.childNodes) {
      const text = node.childNodes.map((c) => c.value || "").join("");
      specs.push(...extractFromCss(text, baseUrl));
    }
    if (node.childNodes) node.childNodes.forEach(walk);
  };
  walk(doc);
  return resolveAll(specs, baseUrl);
}

function extractFromCssInline(style: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of style.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) out.push(m[2]);
  return out; // già path, risolti da resolveAll del chiamante via HTML
}

export { parseFragment };
