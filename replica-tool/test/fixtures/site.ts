/*
 * Sito di prova che riproduce le 10 trappole + due "server-spia" che registrano OGNI
 * richiesta ricevuta. Il server principale è l'origine del sito; il secondo è una CDN
 * esterna (font/immagini esterni → vanno copiati in locale e MAI richiesti dalla replica).
 */
import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

export interface SpyServer {
  server: http.Server;
  port: number;
  origin: string;
  requests: { method: string; url: string }[];
  reset: () => void;
}

const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d" +
    "49444154789c6360000002000154a24f5f0000000049454e44ae426082",
  "hex",
);

function makeWav(): Buffer {
  const sampleRate = 8000;
  const n = sampleRate; // 1 secondo
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf; // silenzio
}
const WAV = makeWav();

function indexHtml(integrity: string): string {
  // integrity VALIDO sull'origine (il sito reale funziona) → noi modifichiamo i file e
  // lo rimuoviamo, altrimenti la replica si romperebbe; anti-bot (trap #4); css (trap #3);
  // module entry; audio (trap #6). favicon data: per non generare richieste /favicon.ico.
  return `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sito di prova</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/assets/style.css" integrity="${integrity}" crossorigin="anonymous">
<link rel="preconnect" href="https://fonts.gstatic.com">
<script src="/cdn-cgi/challenge-platform/h/b/scripts/main.js"></script>
<script type="module" src="/assets/main.js"></script>
</head><body>
<div id="app"><noscript>JS richiesto</noscript></div>
</body></html>`;
}

function styleCss(cdn: string): string {
  return `@import "/assets/base.css";
body{margin:0;background:#0c7a5b;color:#eafff5;font-family:system-ui,Segoe UI,Roboto,sans-serif}
#app{max-width:760px;margin:0 auto;padding:30px;background:url('/assets/bg.png') repeat}
.hero{font-size:44px;font-weight:800;margin:10px 0}
nav{display:flex;gap:14px;margin-bottom:16px}
nav a{color:#bff7e3;text-decoration:none}
.badge{display:inline-block;width:32px;height:32px;background:url('${cdn}/badge.png') no-repeat center/contain;vertical-align:middle}
button{background:#064e3b;color:#fff;border:0;padding:10px 16px;border-radius:8px;font-size:15px;cursor:pointer}
img{max-width:100%;display:block;margin:12px 0}
form{display:flex;flex-direction:column;gap:8px;max-width:340px;margin-top:12px}
input,textarea{padding:10px;border-radius:6px;border:1px solid #0a5;font-size:14px}
`;
}

function mainJs(origin: string, cdn: string): string {
  // costante-origine (trap #7), import dinamico + __vite__mapDeps (trap #2),
  // area riservata via pushState (trap #8), fetch interno (catturato) ed esterno (bloccato)
  return `const SITE = ${JSON.stringify(origin)};
const CDN = ${JSON.stringify(cdn)};
const __vite__mapDeps = (indexes) => indexes;
const DEPS = __vite__mapDeps(["/assets/login-chunk.js"]);
const app = document.getElementById("app");

function homeHtml(){
  return \`
    <nav><a href="/">Home</a> <a id="chi">Chi siamo</a> <span class="badge"></span></nav>
    <h1 class="hero">Il mio sito di prova</h1>
    <img class="lazyimg" loading="lazy" src="/assets/hero-1x.png" srcset="/assets/hero-1x.png 1x, /assets/hero-2x.png 2x" width="80" height="80" alt="hero">
    <img class="cdnimg" src="\${CDN}/pic.png" width="40" height="40" alt="cdn">
    <audio id="clip" controls preload="metadata" src="/media/clip.wav"></audio>
    <div><button id="area">Area riservata</button></div>
    <form id="contact" name="contact">
      <input name="nome" type="text" placeholder="Nome">
      <textarea name="msg" placeholder="Messaggio"></textarea>
      <button type="submit">Invia</button>
    </form>\`;
}

function renderHome(){
  app.innerHTML = homeHtml();
  const chi = document.getElementById("chi");
  chi.setAttribute("href", SITE + "/chi-siamo"); // link assoluto all'origine, costruito in JS
  document.getElementById("area").addEventListener("click", async () => {
    history.pushState({}, "", "/login");       // cambia URL senza link (trap #8/#9)
    const mod = await import("/assets/login-chunk.js"); // import dinamico (trap #2)
    mod.renderLogin(app);
  });
  // richiesta interna (verrà catturata e servita in locale)
  fetch(SITE + "/api/ping").catch(() => {});
  // richieste esterne (devono essere neutralizzate: la CDN non deve ricevere nulla)
  fetch(CDN + "/track").catch(() => {});
  try { navigator.sendBeacon(CDN + "/beacon", "x"); } catch (e) {}
}

async function route(){
  const p = location.pathname;
  if (p === "/login") { const m = await import("/assets/login-chunk.js"); m.renderLogin(app); }
  else if (p === "/chi-siamo") { app.innerHTML = '<h1 class="hero">Chi siamo</h1><p>Pagina interna.</p><a href="/">Home</a>'; }
  else renderHome();
}
window.addEventListener("popstate", route);
route();
`;
}

function loginChunkJs(): string {
  return `export function renderLogin(app){
  app.innerHTML = \`
    <h1 class="hero">Area riservata</h1>
    <form id="login" name="login">
      <input name="email" type="email" placeholder="Email" autocomplete="username" required>
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
      <button type="submit">Accedi</button>
    </form>
    <a href="/">← Home</a>\`;
}
`;
}

function makeSpy(name: string, handler: (req: http.IncomingMessage, res: http.ServerResponse, spy: SpyServer) => void): Promise<SpyServer> {
  return new Promise((resolve) => {
    const spy: SpyServer = {
      server: null as any,
      port: 0,
      origin: "",
      requests: [],
      reset: () => {
        spy.requests.length = 0;
      },
    };
    const server = http.createServer((req, res) => {
      spy.requests.push({ method: req.method || "GET", url: req.url || "/" });
      handler(req, res, spy);
    });
    spy.server = server;
    server.listen(0, "127.0.0.1", () => {
      spy.port = (server.address() as AddressInfo).port;
      spy.origin = `http://127.0.0.1:${spy.port}`;
      resolve(spy);
    });
  });
}

function sendRange(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, type: string): void {
  const range = req.headers.range;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", type);
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : body.length - 1;
      const chunk = body.subarray(start, end + 1);
      res.statusCode = 206; // trap #6: risposta parziale
      res.setHeader("Content-Range", `bytes ${start}-${end}/${body.length}`);
      res.setHeader("Content-Length", String(chunk.length));
      res.end(chunk);
      return;
    }
  }
  res.statusCode = 200;
  res.setHeader("Content-Length", String(body.length));
  res.end(body);
}

export interface TestSite {
  origin: string;
  cdnOrigin: string;
  main: SpyServer;
  cdn: SpyServer;
  resetSpies: () => void;
  close: () => Promise<void>;
}

export async function startTestSite(): Promise<TestSite> {
  const cdn = await makeSpy("cdn", (req, res) => {
    const u = (req.url || "/").split("?")[0];
    if (u === "/pic.png" || u === "/badge.png") {
      res.setHeader("content-type", "image/png");
      res.end(PNG_1x1);
    } else {
      // track/beacon ecc.: la replica non deve MAI arrivare qui
      res.setHeader("content-type", "text/plain");
      res.end("ok");
    }
  });

  const cdnOrigin = cdn.origin;
  const styleContent = styleCss(cdnOrigin);
  const styleIntegrity = "sha256-" + createHash("sha256").update(styleContent).digest("base64");
  const html = indexHtml(styleIntegrity);

  const main = await makeSpy("main", (req, res) => {
    const u = (req.url || "/").split("?")[0];
    const send = (type: string, body: string | Buffer) => {
      res.setHeader("content-type", type);
      res.end(body);
    };
    if (u === "/" || u === "/index.html") return send("text/html; charset=utf-8", html);
    if (u === "/assets/style.css") return send("text/css", styleContent);
    if (u === "/assets/base.css") return send("text/css", "*{box-sizing:border-box}html,body{height:100%}");
    if (u === "/assets/main.js") return send("application/javascript", mainJs(main.origin, cdnOrigin));
    if (u === "/assets/login-chunk.js") return send("application/javascript", loginChunkJs());
    if (u === "/assets/bg.png" || u === "/assets/hero-1x.png" || u === "/assets/hero-2x.png")
      return send("image/png", PNG_1x1);
    if (u === "/cdn-cgi/challenge-platform/h/b/scripts/main.js")
      return send("application/javascript", "window.__challenge_ok=1;");
    if (u === "/media/clip.wav") return sendRange(req, res, WAV, "audio/wav");
    if (u === "/api/ping") return send("application/json", JSON.stringify({ ok: true, v: 1 }));
    if (u === "/chi-siamo" || u === "/login") return send("text/html; charset=utf-8", html);
    if (u === "/sitemap.xml") {
      return send(
        "application/xml",
        `<?xml version="1.0"?><urlset><url><loc>${main.origin}/</loc></url>` +
          `<url><loc>${main.origin}/chi-siamo</loc></url></urlset>`,
      );
    }
    res.statusCode = 404;
    send("text/plain", "not found");
  });

  // main.origin usato dentro mainJs: era non noto prima di listen → rigeneriamo al volo
  // (mainJs legge main.origin al momento della richiesta, quindi è già corretto)

  return {
    origin: main.origin,
    cdnOrigin,
    main,
    cdn,
    resetSpies: () => {
      main.reset();
      cdn.reset();
    },
    close: async () => {
      await new Promise<void>((r) => main.server.close(() => r()));
      await new Promise<void>((r) => cdn.server.close(() => r()));
    },
  };
}
