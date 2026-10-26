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

- Panel server + UI (domini, replicate, SSE, link+QR, sessioni, replay). Boot ok.
- Verify (rete bloccata, richieste fallite, errori JS, diff screenshot desktop/mobile).
- Test site 10 trappole + due server-spia (origine + CDN).
- **E2E full-flow attraverso il pannello + `pnpm test:all`: PASSA.**
- EVIDENCE/test-output.txt (output reale), README (IT), LIMITS.md.

## Stato: COMPLETATO (v1)
Tutti i criteri di "fatto" verificati dai test:
- E2E passa integralmente;
- spy origine 0 e spy CDN 0 richieste durante la navigazione della replica;
- replica del sito di prova: 0 richieste fallite, 0 errori JS nuovi, diff screenshot
  0% desktop e 0% mobile (≤ 1%);
- login simulato: errore realistico, 0 richieste esterne;
- sessione mobile visibile nel pannello in tempo reale e riproducibile dal link
  permanente; nessuna password nel database.

## Da fare (eventuali estensioni future)
Vedi LIMITS.md (login pannello, HTTPS, service worker/MSW, Docker, mutation testing,
grafo di stati, verifica a 4 livelli).

## Note / decisioni
- Un solo processo Node: pannello su localhost + un server per replica su 0.0.0.0,
  DB ed EventEmitter condivisi.
- Motore generico URL-driven; sito di prova = solo banco di prova automatico.
