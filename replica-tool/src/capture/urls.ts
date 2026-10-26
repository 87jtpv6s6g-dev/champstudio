/**
 * Mappatura URL → percorso locale, condivisa tra cattura e replica server così che
 * concordino su dove vivono i file. Tutti i percorsi restituiti sono root-relative
 * (iniziano con "/"). Le risorse esterne finiscono sotto /_ext/<host>/...
 */

export function toOrigin(input: string): string {
  return new URL(input).origin;
}

export function tryUrl(input: string, base?: string): URL | null {
  try {
    return new URL(input, base);
  } catch {
    return null;
  }
}

export function isHttp(u: URL): boolean {
  return u.protocol === "http:" || u.protocol === "https:";
}

export function hostSegment(u: URL): string {
  const h = u.hostname + (u.port ? "_" + u.port : "");
  return h.replace(/[^a-z0-9._-]/gi, "_");
}

/** Prefisso della cartella per una risorsa: "" se stessa origine, /_ext/<host> altrimenti. */
function baseFor(u: URL, origin: string): string {
  return u.origin === origin ? "" : "/_ext/" + hostSegment(u);
}

function lastSegmentHasExt(pathname: string): boolean {
  const seg = pathname.split("/").pop() || "";
  return /\.[a-z0-9]{1,8}$/i.test(seg);
}

/** Percorso locale per un ASSET (non-HTML): usa il pathname così com'è. */
export function assetLocalPath(u: URL, origin: string): string {
  let p = u.pathname;
  if (p.endsWith("/")) p += "index"; // raro per asset
  return (baseFor(u, origin) + p).replace(/\/{2,}/g, "/");
}

/** Percorso locale per una PAGINA HTML: cartella → index.html, refresh su route interne ok. */
export function pageLocalPath(u: URL, origin: string): string {
  let p = u.pathname;
  if (p === "" ) p = "/";
  if (p.endsWith("/")) {
    p += "index.html";
  } else if (!lastSegmentHasExt(p)) {
    p += "/index.html";
  }
  return (baseFor(u, origin) + p).replace(/\/{2,}/g, "/");
}

/** Percorso locale generico in base al content-type. */
export function localPathFor(u: URL, origin: string, contentType: string | undefined): string {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/html")) return pageLocalPath(u, origin);
  return assetLocalPath(u, origin);
}
