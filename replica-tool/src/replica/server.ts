/**
 * Server della replica: ogni replica alla RADICE della sua porta (mai sotto /p/nome/).
 * Ascolta su 0.0.0.0 per il telefono. MIME corretti, Range per audio/video (via
 * res.sendFile), fallback SPA (route senza estensione → entry/index.html; file con
 * estensione mancante → 404 reale, mai HTML). Endpoint /__mirror/* per runtime e rrweb.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { REPLICA_BIND, replicaDir } from "../config.js";
import { isolationJs, recordJs, rrwebJs } from "./inject/index.js";
import { sessions } from "../db/index.js";
import { bus } from "../bus.js";
import type { ReplicaMeta } from "../capture/index.js";

export interface RunningReplica {
  buildId: string;
  port: number;
  url: (host: string) => string;
  close: () => Promise<void>;
}

function siteDir(buildId: string): string {
  return path.join(replicaDir(buildId), "site");
}

function hasExt(pathname: string): boolean {
  const seg = pathname.split("/").pop() || "";
  return /\.[a-z0-9]{1,8}$/i.test(seg);
}

function safeJoin(root: string, rel: string): string | null {
  const dest = path.resolve(root, "." + (rel.startsWith("/") ? rel : "/" + rel));
  if (dest !== root && !dest.startsWith(root + path.sep)) return null;
  return dest;
}

export async function startReplicaServer(meta: ReplicaMeta): Promise<RunningReplica> {
  const root = siteDir(meta.buildId);
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");

  const JS = "application/javascript; charset=utf-8";

  /* ---------- canale interno del mirror ---------- */
  app.get("/__mirror/manifest.js", (_req, res) => {
    const payload = {
      id: meta.buildId,
      origin: meta.origin,
      entryPath: meta.entryPath,
      assets: meta.manifest,
    };
    res.type(JS).send("window.__REPLICA__ = " + JSON.stringify(payload) + ";");
  });
  app.get("/__mirror/isolation.js", (_req, res) => res.type(JS).send(isolationJs));
  app.get("/__mirror/rrweb.js", (_req, res) => res.type(JS).send(rrwebJs));
  app.get("/__mirror/record.js", (_req, res) => res.type(JS).send(recordJs));

  app.post("/__mirror/rec", express.json({ limit: "20mb" }), (req, res) => {
    try {
      const body = req.body || {};
      const sessionId = String(body.sessionId || req.query.session || "");
      const replicaId = String(body.replicaId || meta.buildId);
      const ua = String(body.ua || req.headers["user-agent"] || "");
      const events = Array.isArray(body.events) ? body.events : [];
      if (sessionId && events.length) {
        sessions.upsert(sessionId, replicaId, ua);
        sessions.addEvents(
          sessionId,
          events.map((e: any) => ({ type: e.type, timestamp: e.timestamp, data: e })),
        );
        bus.emitEvent({ kind: "session", replicaId, sessionId, data: { events, ua } });
        bus.emitEvent({ kind: "sessions-changed" });
      }
      res.status(204).end();
    } catch (e) {
      res.status(204).end();
    }
  });

  /* ---------- file statici + fallback SPA ---------- */
  const serveFile = (res: express.Response, absFile: string, rel: string) => {
    const ct = meta.paths[rel]?.contentType;
    if (ct) res.setHeader("Content-Type", ct);
    res.sendFile(
      absFile,
      { acceptRanges: true, cacheControl: false, dotfiles: "allow" },
      (err) => {
        if (err && !res.headersSent) res.status(500).end();
      },
    );
  };

  const resolveServable = (pathname: string): { abs: string; rel: string } | null => {
    const candidates: string[] = [];
    if (pathname === "/") candidates.push(meta.entryPath);
    candidates.push(pathname);
    candidates.push(pathname.endsWith("/") ? pathname + "index.html" : pathname + "/index.html");
    for (const rel of candidates) {
      const abs = safeJoin(root, rel);
      if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        return { abs, rel: rel === meta.entryPath && pathname === "/" ? meta.entryPath : rel };
      }
    }
    return null;
  };

  app.use((req, res) => {
    const pathname = decodeURIComponent((req.path || "/").split("?")[0]);
    const found = resolveServable(pathname);
    if (found) return serveFile(res, found.abs, found.rel);

    // fallback SPA: route senza estensione → entry (index) con 200
    if (!hasExt(pathname)) {
      const entryAbs = safeJoin(root, meta.entryPath);
      if (entryAbs && fs.existsSync(entryAbs)) return serveFile(res, entryAbs, meta.entryPath);
    }
    // file con estensione mancante → 404 reale (mai HTML)
    res.status(404).type("text/plain").send("404 Not Found");
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, REPLICA_BIND, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    buildId: meta.buildId,
    port,
    url: (host: string) => `http://${host}:${port}/`,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
