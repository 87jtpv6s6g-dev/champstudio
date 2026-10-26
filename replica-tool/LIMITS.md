# LIMITS — limiti noti della v1

Questa è la prima versione funzionante, pensata per un primo test completo del processo.
Di seguito i limiti noti e le scelte consapevoli, così da sapere cosa aspettarsi.

## Fuori scope per scelta (verranno dopo)
- **Login del pannello**, **HTTPS**, **Docker/deploy su server**.
- **Service worker / MSW**: il service worker originale viene disattivato nella replica;
  non viene reintrodotto un livello di mocking delle richieste.
- **Mutation testing**, **grafo di stati avanzato**, **verifica a quattro livelli**: la
  verifica attuale è a un livello (richieste fallite, errori JS nuovi, diff screenshot
  desktop/mobile).

Il codice è organizzato per poter aggiungere queste parti senza riscriverlo.

## Limiti tecnici attuali
- **Snapshot statico**: le risposte dinamiche (API, dati) vengono "congelate" al momento
  della cattura. La replica serve quella copia; non ci sono backend né database. I dati non
  si aggiornano e le funzioni che richiedono scritture server non hanno effetto reale.
- **Challenge anti-bot (Cloudflare) non aggirate in cattura**: se il sito presenta una
  challenge, la cattura va eseguita da un IP/rete già affidabile o con la protezione
  temporaneamente abbassata (vedi README). Nella replica gli script anti-bot vengono poi
  rimossi.
- **Query string ignorata nel matching dei file**: i file sono salvati per percorso; due
  risorse con lo stesso percorso ma query diverse collidono (raro).
- **Risorse esterne costruite a runtime**: immagini/script con URL esterni creati via JS
  vengono reindirizzati alla copia locale **se catturati**; se non catturati vengono
  neutralizzati (nessuna richiesta in uscita, immagine vuota). I font/immagini esterni
  referenziati staticamente in HTML/CSS vengono copiati in locale.
- **WebSocket / EventSource esterni**: stubati (non si connettono). Le funzionalità realtime
  non funzionano nella replica.
- **Replay multi-pagina**: ogni ricaricamento completo di pagina genera un nuovo snapshot
  rrweb. Il replay è ideale su navigazioni in-page (SPA). Una sessione che attraversa più
  ricaricamenti è registrata ma il player mostra un segmento per volta.
- **Link di rete (telefono)**: viene usato il primo IPv4 non interno rilevato. Su macchine
  con più interfacce potrebbe non essere quello giusto: si può forzare con la variabile
  d'ambiente `PANEL_NET_HOST`.
- **Limiti di cattura**: massimo ~25 pagine e ~1500 risorse per build (configurabile nel
  codice). Pensati per siti di dimensioni normali.
- **Diff screenshot**: confronta la pagina d'ingresso in desktop e mobile. Soglia di
  "pronta" ≤ 1%. Animazioni o contenuti non deterministici possono aumentare la differenza
  e portare l'esito a "da rivedere".
- **Persistenza repliche tra riavvii**: al riavvio del pannello le repliche già "pronte"
  vengono riservite, ma la porta può cambiare (quindi anche link e QR).

## Privacy
- Le **password** sono sempre mascherate da rrweb (`maskInputOptions.password`) e non
  finiscono nel database. Gli altri campi dei form vengono registrati come parte della
  sessione: trattare il database `.data/` come dati interni.
