# PLAN — Strumento di replica e test dei propri siti (v1)

## Obiettivo
Dato un URL incollato nel pannello, catturare il sito reale, produrne una **replica
locale isolata** (nessuna richiesta verso l'origine o servizi esterni), servirla alla
radice di una porta (raggiungibile da computer e telefono sulla stessa Wi-Fi), e
registrare/riprodurre le sessioni di navigazione in tempo reale.

> Lo strumento è **generico**: funziona con qualsiasi URL dei miei siti, anche SPA
> complesse. Il sito di prova con le 10 trappole è solo il banco di prova automatico
> (`pnpm test:all`), non un caso particolare cablato nel codice. Il flusso è sempre:
> **incollo il link → lo script si configura da quel link → replica**.

## Stack
Node 22 · TypeScript via `tsx` · pnpm · Express 5 · Playwright · vitest · SQLite
(`better-sqlite3`) · `es-module-lexer` · `postcss` · `parse5` · `rrweb` / `rrweb-player`
· `pixelmatch`+`pngjs` · `qrcode`. Versioni esatte in `package.json`.

## Architettura (un solo processo Node)
- **Panel server** (`src/panel`): ascolta solo su `127.0.0.1`. UI HTML/JS + SSE.
  Gestione domini consentiti, avvio build, avanzamento live, link+QR, sessioni, replay.
- **Capture** (`src/capture`): Playwright reale. `crawler` scopre pagine (sitemap, link
  interni, click su tab/menu/pulsanti, pushState). `resolver` trova dipendenze mancanti
  (import JS, `url()`/`@import` CSS, attributi HTML) e scarica fino a punto fisso.
  `rewriter` neutralizza l'origine e inietta isolamento + rrweb.
- **Replica server** (`src/replica`): un server HTTP per replica, su `0.0.0.0`, contenuti
  alla **radice** della porta. MIME corretti, Range per audio/video, fallback SPA, 404
  reale. Endpoint `/__mirror/rec` per gli eventi rrweb.
- **Browser runtime** (`src/replica/inject`): `isolation.js` (iniettato per primo nel
  `<head>`) + recorder rrweb (password sempre mascherate).
- **Verify** (`src/verify`): apre la replica con rete esterna bloccata, conta richieste
  fallite e nuovi errori JS vs originale, confronta screenshot desktop/mobile.
- **DB** (`src/db`): SQLite per domini, build, repliche, sessioni, eventi. Bus in-process
  (EventEmitter) per inoltrare eventi live al pannello via SSE.

## Dati su disco
`.data/` (DB SQLite) · `.replicas/<buildId>/` (file del sito catturato) ·
`.artifacts/<buildId>/` (screenshot/diff di verifica). Esclusi da git.

## Mappa delle 10 trappole → dove sono gestite
1. Prefisso raddoppiato → replica sempre alla radice (`replica/server.ts`).
2. Import dinamici / `__vite__mapDeps` → `resolver` (es-module-lexer + scansione mapDeps).
3. CSS scaricato ma non applicato → `resolver` CSS (postcss) + rewriter conserva i path.
4. Anti-bot come risorsa essenziale → `rewriter` rimuove `/cdn-cgi/challenge-platform`.
5. "body non disponibile"/"pagina chiusa" → `crawler` legge i corpi subito, chiude dopo.
6. Audio 206 parziale → `crawler` riscarica intero; `replica` serve con Range.
7. Link/pulsanti verso l'origine (anche da JS) → rewriter (statico) + isolation (runtime).
8. Login raggiungibile solo da pulsante → `crawler` clicca pulsanti senza link + pushState.
9. Refresh su route interna → fallback SPA del `replica/server.ts`.
10. rrweb salva password/altera aspetto → `maskInputOptions.password`, recorder passivo.

## Ordine di lavoro
1. Docs (PLAN/PROGRESS). 2. DB + bus + config. 3. Browser runtime (isolation+rrweb).
4. Capture (crawler→resolver→rewriter). 5. Replica server. 6. Panel + UI. 7. Verify.
8. Test site (10 trappole) + spy server. 9. E2E + `test:all` + evidenze + README/LIMITS.

## Definizione di "fatto"
Tutte verificate dai test: E2E passa integralmente; spy server 0 richieste durante la
navigazione della replica; replica del sito di prova 0 richieste fallite, 0 errori JS
nuovi, diff screenshot ≤ 1% desktop e mobile; login simulato con errore realistico e 0
richieste esterne; sessione mobile visibile live nel pannello e riproducibile; nessuna
password nel DB.

## Fuori scope v1 (predisposto, non costruito)
Login pannello, HTTPS, service worker/MSW, Docker, deploy, mutation testing, grafo di
stati avanzato, verifica a 4 livelli.
