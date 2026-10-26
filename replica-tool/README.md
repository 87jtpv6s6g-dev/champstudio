# Replica Tool — v1

Strumento **privato** per test interni sui **tuoi** siti. Incolli l'URL di un tuo sito nel
pannello e lo strumento ne crea una **replica locale identica e completamente isolata**:
conserva ed esegue il codice originale (HTML, CSS, JS), ma non fa **nessuna** richiesta
verso il sito reale o servizi esterni. Puoi aprirla dal computer o dal telefono (stessa
Wi-Fi) e **rivedere la tua navigazione** come replay.

> È generico: funziona con qualsiasi tuo sito, anche SPA complesse. Il flusso è sempre lo
> stesso — **incolli il link, premi "Replica", e lo script si configura da quel link**.

## Requisiti
- **Node 22** e **pnpm**.
- Un browser Chromium (in questo ambiente è già preinstallato; in locale viene usato quello
  di Playwright — vedi sotto).

## Installazione
```bash
cd replica-tool
pnpm install
```
`pnpm install` compila il modulo nativo `better-sqlite3` (è già autorizzato nel
`package.json`). Se per qualche motivo non venisse compilato:
```bash
pnpm rebuild better-sqlite3
```
Se **non** sei in questo ambiente cloud e Playwright non trova il browser, installalo una
volta sola:
```bash
pnpm exec playwright install chromium
```
(In questo ambiente il browser è già presente sotto `/opt/pw-browsers` e viene usato in
automatico; non serve installarlo.)

## Avviare il pannello (un comando)
```bash
pnpm panel
```
Poi apri nel browser del computer:
```
http://127.0.0.1:7331
```
Il pannello ascolta **solo su localhost**.

## Come si usa
1. **Domini consentiti**: scrivi l'host del tuo sito (es. `www.miosito.it` oppure incolla
   un URL completo) e premi **Aggiungi**. Puoi gestirli da lì.
2. **Replica un sito**: incolla l'URL (deve appartenere a un dominio consentito) e premi
   **Replica**.
3. L'area **Avanzamento** mostra in diretta: pagine catturate, risorse scaricate,
   riscrittura, verifica.
4. Al termine, nella scheda della replica trovi:
   - il **link per il computer** (`http://127.0.0.1:<porta>/`),
   - il **link di rete per il telefono** (`http://<ip-LAN>:<porta>/`),
   - il **QR code** del link di rete,
   - l'esito della verifica (**pronta / da rivedere / fallita**) con le immagini di
     differenza desktop/mobile.

## Aprire la replica dal telefono
1. Il telefono deve essere sulla **stessa Wi-Fi** del computer.
2. Scansiona il **QR code** mostrato nel pannello (oppure apri a mano il link di rete).
3. Naviga: è il tuo sito, identico e navigabile, ma **separato** da quello vero. I form di
   login mostrano un errore realistico di credenziali non valide; gli altri form una
   conferma di invio. Nessuna richiesta esce verso l'esterno.

## Rivedere le sessioni
Mentre navighi (da computer o telefono), nel pannello compaiono le **sessioni in tempo
reale**. Ogni sessione ha un **link permanente** `http://127.0.0.1:7331/sessions/<id>` che
apre il **replay** (con `rrweb-player`). Le **password sono sempre mascherate** e non
vengono salvate.

## Test automatici
```bash
pnpm test:all
```
Esegue l'intero flusso end-to-end con un sito di prova che riproduce 10 "trappole" tipiche,
due server-spia che verificano che la replica non contatti l'esterno, e i controlli di
autonomia/privacy. L'output reale e integrale viene salvato in
[`EVIDENCE/test-output.txt`](EVIDENCE/test-output.txt).

## Se la cattura viene bloccata da Cloudflare
Questa prima versione **non aggira** le challenge anti-bot (es. `cdn-cgi/challenge-platform`):
durante la **cattura** il browser deve poter vedere le pagine reali. Se incontri una
schermata di challenge:
- essendo un **tuo** sito, metti in whitelist l'IP da cui esegui la cattura nel pannello di
  Cloudflare (Security → WAF / Tools), oppure abbassa temporaneamente il livello di
  protezione (es. "Under Attack" → off) per quell'IP mentre catturi;
- in alternativa cattura da una rete/IP già considerato affidabile dal tuo sito;
- riprova: le challenge sono spesso temporanee.

Nota: nella **replica** gli script anti-bot vengono comunque rimossi, quindi una volta
catturato il sito la replica non mostra più la challenge. Il riuso di un profilo browser già
autenticato/"superato" è previsto per una versione successiva.

## Struttura del progetto
```
src/
  config.ts            percorsi e configurazione
  bus.ts               event bus in-process (→ SSE del pannello)
  types.ts             tipi condivisi
  db/                  SQLite (domini, build, repliche, sessioni, eventi)
  capture/             motore di cattura
    browser.ts         avvio Chromium (usa il browser preinstallato)
    crawler.ts         discovery (Playwright) + download + fixpoint dipendenze
    resolver.ts        es-module-lexer / PostCSS / parse5
    rewriter.ts        neutralizzazione origine + iniezione isolamento/rrweb
    urls.ts            mappatura URL → percorso locale
    index.ts           orchestratore della build
  replica/
    server.ts          server della replica (radice porta, Range, fallback SPA)
    inject/            runtime browser: isolation.js + recorder rrweb
  verify/verify.ts     verifica (rete bloccata, richieste/errori, diff screenshot)
  panel/
    server.ts          pannello (localhost): API, SSE, replay
    manager.ts         ciclo di vita delle repliche + link/QR
    public/            UI del pannello
  bin/panel.ts         avvio del pannello
test/
  fixtures/site.ts     sito di prova (10 trappole) + server-spia
  e2e/full-flow.test.ts test end-to-end completo
  run-all.ts           orchestratore di `pnpm test:all`
```

## Note di sicurezza (v1)
- Il pannello ascolta **solo** su `127.0.0.1`. Le repliche ascoltano su `0.0.0.0` per essere
  raggiungibili dal telefono sulla LAN: usale su una rete fidata.
- Durante la cattura lo strumento **non** invia mai form, **non** clicca
  logout/elimina/paga/checkout, **non** esporta cookie.
- Vedi [`LIMITS.md`](LIMITS.md) per i limiti noti di questa versione.
