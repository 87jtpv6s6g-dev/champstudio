/**
 * Riscrittura: conserva i percorsi originali (nessuna rinomina), ma neutralizza
 * l'origine del sito così la replica è autonoma.
 *  - HTML/CSS: URL assoluti alla stessa origine → root-relative; esterni catturati →
 *    /_ext/<host>/...; rimozione integrity, script anti-bot e tracker; iniezione di
 *    isolamento + rrweb.
 *  - JS: costante-origine e URL assoluti alla stessa origine → location.origin + path.
 */
import { parse as parseHtml, serialize, parseFragment } from "parse5";
import postcss from "postcss";
import { tryUrl, isHttp, assetLocalPath } from "./urls.js";
import { headInjectionTags, INJECT_MARKER } from "../replica/inject/index.js";

const TRACKER_SRC = [
  "/cdn-cgi/challenge-platform",
  "google-analytics.com",
  "googletagmanager.com",
  "gtag/js",
  "connect.facebook.net",
  "static.hotjar.com",
  "cdn.segment.com",
  "api.segment.io",
  "cdn.mxpnl.com",
  "doubleclick.net",
  "fullstory.com",
  "clarity.ms",
];

function isTrackerSrc(src: string): boolean {
  const s = src.toLowerCase();
  return TRACKER_SRC.some((t) => s.includes(t));
}

/** URL assoluto → valore locale per attributi HTML/CSS, oppure null se invariato. */
function mapRefUrl(
  spec: string,
  baseUrl: string,
  origin: string,
  captured: Set<string>,
): string | null {
  const t = spec.trim();
  if (!t || /^(data:|blob:|mailto:|tel:|javascript:|#)/i.test(t)) return null;
  const u = tryUrl(t, baseUrl);
  if (!u || !isHttp(u)) return null;
  if (u.origin === origin) return u.pathname + u.search + u.hash;
  if (captured.has(u.toString()) || captured.has(stripHash(u))) return assetLocalPath(u, origin);
  return null;
}

function stripHash(u: URL): string {
  const c = new URL(u.toString());
  c.hash = "";
  return c.toString();
}

function rewriteSrcset(value: string, baseUrl: string, origin: string, captured: Set<string>): string {
  return value
    .split(",")
    .map((part) => {
      const seg = part.trim();
      if (!seg) return "";
      const bits = seg.split(/\s+/);
      const mapped = mapRefUrl(bits[0], baseUrl, origin, captured);
      if (mapped) bits[0] = mapped;
      return bits.join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

/* ----------------------------- CSS ----------------------------- */
export function rewriteCss(
  css: string,
  baseUrl: string,
  origin: string,
  captured: Set<string>,
): string {
  let root;
  try {
    root = postcss.parse(css);
  } catch {
    return css;
  }
  root.walkDecls((decl) => {
    decl.value = decl.value.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, url) => {
      const mapped = mapRefUrl(url, baseUrl, origin, captured);
      return mapped ? `url(${q}${mapped}${q})` : m;
    });
  });
  root.walkAtRules("import", (rule) => {
    rule.params = rule.params.replace(/(['"])([^'"]+)\1|url\(\s*(['"]?)([^'")]+)\3\s*\)/, (m, ...g) => {
      const url = g[1] || g[3];
      const q = g[0] ? g[0] : g[2] || "";
      const mapped = url ? mapRefUrl(url, baseUrl, origin, captured) : null;
      if (!mapped) return m;
      return g[0] ? `${q}${mapped}${q}` : `url(${q}${mapped}${q})`;
    });
  });
  return root.toString();
}

/* ----------------------------- JS ----------------------------- */
export function rewriteJs(js: string, origin: string): string {
  const u = new URL(origin);
  // Match di string-literal che iniziano con l'origine: "http://host:port/path"
  const originEsc = escapeRegExp(origin);
  const re = new RegExp("(['\"`])" + originEsc + "(/[^'\"`]*)?\\1", "g");
  let out = js.replace(re, (_m, _q, path) => {
    const p = path || "";
    return "(location.origin + " + JSON.stringify(p) + ")";
  });
  // Anche forma protocol-relative //host:port
  const hostEsc = escapeRegExp(u.host);
  const re2 = new RegExp("(['\"`])//" + hostEsc + "(/[^'\"`]*)?\\1", "g");
  out = out.replace(re2, (_m, _q, path) => "(location.origin + " + JSON.stringify(path || "") + ")");
  return out;
}

/* ----------------------------- HTML ----------------------------- */
type P5 = {
  tagName?: string;
  nodeName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: P5[];
  parentNode?: P5 | null;
  value?: string;
};

const URL_ATTRS = new Set(["src", "href", "poster", "data-src", "data-href"]);

export function rewriteHtml(
  html: string,
  pageUrl: string,
  origin: string,
  captured: Set<string>,
): string {
  const doc = parseHtml(html) as unknown as P5;

  let headEl: any = null;
  let htmlEl: any = null;
  let bodyEl: any = null;

  const removeFromParent = (node: P5) => {
    const p = node.parentNode;
    if (p && p.childNodes) {
      const i = p.childNodes.indexOf(node);
      if (i >= 0) p.childNodes.splice(i, 1);
    }
  };

  const toRemove: P5[] = [];

  const walk = (node: P5, parent: P5 | null) => {
    node.parentNode = parent;
    const tag = node.tagName;
    if (tag === "head" && !headEl) headEl = node;
    if (tag === "html" && !htmlEl) htmlEl = node;
    if (tag === "body" && !bodyEl) bodyEl = node;

    if (node.attrs) {
      // rimuovi integrity (i file vengono modificati) e marca gli script tracker/anti-bot
      node.attrs = node.attrs.filter((a) => a.name.toLowerCase() !== "integrity");

      if (tag === "script") {
        const srcAttr = node.attrs.find((a) => a.name.toLowerCase() === "src");
        if (srcAttr && isTrackerSrc(srcAttr.value)) toRemove.push(node);
      }
      if (tag === "link") {
        const rel = (node.attrs.find((a) => a.name.toLowerCase() === "rel")?.value || "").toLowerCase();
        const href = node.attrs.find((a) => a.name.toLowerCase() === "href")?.value || "";
        if (rel.includes("preconnect") || rel.includes("dns-prefetch")) toRemove.push(node);
        if (isTrackerSrc(href)) toRemove.push(node);
      }

      for (const a of node.attrs) {
        const name = a.name.toLowerCase();
        if (URL_ATTRS.has(name)) {
          const mapped = mapRefUrl(a.value, pageUrl, origin, captured);
          if (mapped) a.value = mapped;
        } else if (name === "srcset") {
          a.value = rewriteSrcset(a.value, pageUrl, origin, captured);
        } else if (name === "style") {
          a.value = rewriteCss(a.value, pageUrl, origin, captured);
        }
      }
    }

    // inline <style> e <script>
    if (tag === "style" && node.childNodes) {
      for (const c of node.childNodes) {
        if (typeof c.value === "string") c.value = rewriteCss(c.value, pageUrl, origin, captured);
      }
    }
    if (tag === "script" && node.childNodes) {
      const typeAttr = (node.attrs?.find((a) => a.name.toLowerCase() === "type")?.value || "").toLowerCase();
      const isData = typeAttr && !/javascript|module|^$/.test(typeAttr);
      if (!isData) {
        for (const c of node.childNodes) {
          if (typeof c.value === "string") c.value = rewriteJs(c.value, origin);
        }
      }
    }

    if (node.childNodes) [...node.childNodes].forEach((c) => walk(c, node));
  };
  walk(doc, null);

  for (const n of toRemove) removeFromParent(n);

  // iniezione: manifest + isolamento per primi nel <head>; rrweb + record dopo
  const target = headEl || htmlEl || doc;
  if (target) {
    if (htmlEl && htmlEl.attrs && !htmlEl.attrs.some((a: any) => a.name === INJECT_MARKER)) {
      htmlEl.attrs.push({ name: INJECT_MARKER, value: "1" });
    }
    const tags = headInjectionTags();
    const firstNodes = fragmentNodes(tags.first.join("\n"), target);
    const recNodes = fragmentNodes(tags.recorder.join("\n"), target);
    target.childNodes = target.childNodes || [];
    target.childNodes.unshift(...firstNodes);
    target.childNodes.push(...recNodes);
  }

  return serialize(doc as any);
}

function fragmentNodes(html: string, parent: P5): P5[] {
  const frag = parseFragment(html) as unknown as P5;
  const nodes = frag.childNodes || [];
  for (const n of nodes) n.parentNode = parent;
  return nodes;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
