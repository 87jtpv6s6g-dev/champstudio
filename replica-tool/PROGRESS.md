# PROGRESS

Stato aggiornato ad ogni passo, così in caso di interruzione si riprende da qui.

## Fatto
- Scaffolding progetto, `package.json` con versioni esatte.
- Toolchain verificata: `better-sqlite3` nativo compila, Playwright (Chromium
  preinstallato via executablePath) si avvia.
- PLAN.md e PROGRESS.md.
- DB (SQLite) + event bus + config/paths. Smoke test ok.
- Browser runtime: `isolation.js` + recorder rrweb (mask password).
- Capture: crawler Playwright (discovery browser + download via request + fixpoint),
  resolver dipendenze (es-module-lexer/postcss/parse5), rewriter origine + iniezione.
- Replica server (radice porta, 0.0.0.0, Range via sendFile, fallback SPA, 404 reale,
  `/__mirror/*`).
- **Smoke test integrato capture→rewrite→serve: tutto verde** (isolation injected,
  origine neutralizzata, anti-bot/integrity rimossi, link rooted, SPA fallback, 404).

## In corso
- Panel server + UI.

## Da fare
- [ ] Panel server + UI (domini, replicate, SSE, link+QR, sessioni, replay).
- [ ] Verify (rete bloccata, richieste fallite, errori JS, diff screenshot).
- [ ] Test site 10 trappole + spy server.
- [ ] E2E full-flow + `pnpm test:all`.
- [ ] EVIDENCE/test-output.txt, README (IT), LIMITS.md.

## Prossimo passo
Implementare il panel server (`src/panel/server.ts`) + UI, poi verify.

## Note / decisioni
- Un solo processo Node: pannello su localhost + un server per replica su 0.0.0.0,
  DB ed EventEmitter condivisi.
- Motore generico URL-driven; sito di prova = solo banco di prova automatico.
