import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".webmanifest": "application/manifest+json",
};

/**
 * Minimal static file server used to serve trap fixtures as "the original
 * site". Intentionally dumb: no SPA fallback, no Range — the real serve stage
 * (M2) is tested separately. Supports an optional `mime` override map so a
 * fixture can reproduce the "CSS served with wrong MIME" trap (#3).
 */
export async function serveStatic(
  root: string,
  opts: { mimeOverride?: Record<string, string> } = {},
): Promise<{ origin: string; port: number; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      let rel = normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
      if (rel === "/" || rel === "") rel = "/index.html";
      const file = join(root, rel);
      if (!file.startsWith(root)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const s = await stat(file);
      if (!s.isFile()) throw new Error("not a file");
      const ext = extname(file);
      const mime = opts.mimeOverride?.[ext] ?? MIME[ext] ?? "application/octet-stream";
      const body = await readFile(file);
      res.writeHead(200, { "content-type": mime }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
