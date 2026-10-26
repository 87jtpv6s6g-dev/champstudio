/**
 * Panel server: ascolta SOLO su localhost. UI + API + SSE + replay delle sessioni.
 */
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { PANEL_HOST, PANEL_PORT, ARTIFACTS_DIR } from "../config.js";
import { builds, domains, sessions } from "../db/index.js";
import { bus } from "../bus.js";
import {
  startReplication,
  linksFor,
  networkHost,
  restoreReady,
  shutdown,
} from "./manager.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const publicDir = path.join(here, "public");

const rrwebPlayerDir = path.dirname(require.resolve("rrweb-player"));
const rrwebPlayerJs = fs.readFileSync(path.join(rrwebPlayerDir, "rrweb-player.umd.min.cjs"), "utf8");
const rrwebPlayerCss = fs.readFileSync(path.join(rrwebPlayerDir, "style.css"), "utf8");

export interface PanelHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startPanel(): Promise<PanelHandle> {
  await restoreReady();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  /* ---------------- SSE ---------------- */
  app.get("/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`: connesso\n\n`);
    const off = bus.onEvent((ev) => {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    });
    const ping = setInterval(() => res.write(`: ping\n\n`), 20000);
    req.on("close", () => {
      clearInterval(ping);
      off();
    });
  });

  /* ---------------- domini ---------------- */
  app.get("/api/domains", (_req, res) => res.json({ domains: domains.list() }));
  app.post("/api/domains", (req, res) => {
    const host = String(req.body?.host || "").trim().toLowerCase();
    if (!host) return res.status(400).json({ error: "host mancante" });
    // accetta sia "example.com" sia un URL completo
    let h = host;
    try {
      if (/^https?:\/\//.test(host)) h = new URL(host).host;
    } catch {
      /* usa host grezzo */
    }
    domains.add(h);
    res.json({ domains: domains.list() });
  });
  app.delete("/api/domains/:host", (req, res) => {
    domains.remove(decodeURIComponent(req.params.host));
    res.json({ domains: domains.list() });
  });

  /* ---------------- repliche ---------------- */
  app.post("/api/replicate", (req, res) => {
    const url = String(req.body?.url || "").trim();
    const r = startReplication(url);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ buildId: r.buildId });
  });

  app.get("/api/builds", (_req, res) => res.json({ builds: builds.list() }));
  app.get("/api/builds/:id", (req, res) => {
    const b = builds.get(req.params.id);
    if (!b) return res.status(404).json({ error: "non trovato" });
    res.json({ build: b });
  });
  app.get("/api/builds/:id/logs", (req, res) => res.json({ logs: builds.logs(req.params.id) }));
  app.get("/api/builds/:id/links", async (req, res) => res.json(await linksFor(req.params.id)));

  /* ---------------- stato generale ---------------- */
  app.get("/api/state", (_req, res) => {
    res.json({
      domains: domains.list(),
      builds: builds.list(),
      sessions: sessions.list(),
      networkHost: networkHost(),
    });
  });

  /* ---------------- sessioni ---------------- */
  app.get("/api/sessions", (req, res) => {
    const replica = req.query.replica ? String(req.query.replica) : undefined;
    res.json({ sessions: sessions.list(replica) });
  });
  app.get("/api/sessions/:id/events", (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).json({ error: "sessione non trovata" });
    res.json({ session: s, events: sessions.events(req.params.id) });
  });

  /* ---------------- artefatti di verifica (immagini) ---------------- */
  app.get("/api/artifacts/*p", (req, res) => {
    const rel = (req.params as any).p;
    const relPath = Array.isArray(rel) ? rel.join("/") : String(rel || "");
    const abs = path.resolve(ARTIFACTS_DIR, relPath);
    if (abs !== ARTIFACTS_DIR && !abs.startsWith(ARTIFACTS_DIR + path.sep)) {
      return res.status(400).end();
    }
    if (!fs.existsSync(abs)) return res.status(404).end();
    res.sendFile(abs, { dotfiles: "allow" });
  });

  /* ---------------- asset rrweb-player ---------------- */
  app.get("/assets/rrweb-player.js", (_req, res) =>
    res.type("application/javascript; charset=utf-8").send(rrwebPlayerJs),
  );
  app.get("/assets/rrweb-player.css", (_req, res) => res.type("text/css").send(rrwebPlayerCss));

  /* ---------------- replay permanente /sessions/:id ---------------- */
  app.get("/sessions/:id", (req, res) => {
    const s = sessions.get(req.params.id);
    if (!s) return res.status(404).type("text/html").send(replayNotFound(req.params.id));
    res.type("text/html").send(replayPage(req.params.id));
  });

  /* ---------------- UI statica ---------------- */
  app.use(express.static(publicDir));

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(PANEL_PORT, PANEL_HOST, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : PANEL_PORT;

  return {
    port,
    url: `http://${PANEL_HOST}:${port}/`,
    close: async () => {
      await shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function replayPage(id: string): string {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Replay sessione ${id}</title>
<link rel="stylesheet" href="/assets/rrweb-player.css">
<style>
  body{margin:0;background:#0f1115;color:#e7e9ee;font-family:system-ui,Segoe UI,Roboto,sans-serif}
  header{padding:14px 18px;border-bottom:1px solid #222733;display:flex;gap:12px;align-items:center}
  header a{color:#7cc4ff;text-decoration:none}
  .wrap{padding:18px;display:flex;justify-content:center}
  .msg{padding:24px;color:#9aa3b2}
</style></head>
<body>
<header><strong>Replay sessione</strong><code>${id}</code><span style="flex:1"></span>
<a href="/">← Pannello</a></header>
<div class="wrap"><div id="player"><div class="msg">Carico la sessione…</div></div></div>
<script src="/assets/rrweb-player.js"></script>
<script>
(async function(){
  try{
    const r = await fetch('/api/sessions/${id}/events');
    const data = await r.json();
    const events = data.events || [];
    const el = document.getElementById('player');
    el.innerHTML = '';
    if(events.length < 2){ el.innerHTML = '<div class="msg">Sessione senza eventi sufficienti per il replay.</div>'; return; }
    var Player = (window.rrwebPlayer && (window.rrwebPlayer.default || window.rrwebPlayer.Player)) || window.rrwebPlayer;
    new Player({ target: el, props: { events: events, width: 1000, height: 600, autoPlay: true, showController: true } });
  }catch(e){ document.getElementById('player').innerHTML = '<div class="msg">Errore nel caricamento: '+e.message+'</div>'; }
})();
</script>
</body></html>`;
}

function replayNotFound(id: string): string {
  return `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">
  <h1>Sessione non trovata</h1><p>Nessuna sessione con id <code>${id}</code>.</p>
  <p><a href="/">← Pannello</a></p></body>`;
}
