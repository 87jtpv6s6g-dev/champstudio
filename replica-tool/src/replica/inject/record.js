/*
 * record.js — avvia la registrazione rrweb su ogni pagina della replica.
 * Password SEMPRE mascherate. Eventi inviati a /__mirror/rec della replica stessa
 * (same-origin → ammessi da isolation.js), salvati in SQLite e inoltrati al pannello.
 */
(function () {
  "use strict";
  try {
    if (!window.rrweb || typeof window.rrweb.record !== "function") return;
    // La verifica automatica carica la replica senza registrare la sessione.
    if (window.__REPLICA_NOREC__) return;
    var R = window.__REPLICA__ || { id: "" };

    // Session id stabile per l'intera navigazione (persistito nella scheda).
    var sid;
    try {
      sid = sessionStorage.getItem("__replica_sid");
    } catch (e) {}
    if (!sid) {
      sid =
        (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9]/gi, "");
      try { sessionStorage.setItem("__replica_sid", sid); } catch (e) {}
    }

    var buffer = [];
    var sending = false;

    function endpoint() {
      return (
        "/__mirror/rec?session=" +
        encodeURIComponent(sid) +
        "&replica=" +
        encodeURIComponent(R.id || "")
      );
    }

    function flush(useBeacon) {
      if (!buffer.length) return;
      var batch = buffer;
      buffer = [];
      var payload = JSON.stringify({
        sessionId: sid,
        replicaId: R.id || "",
        ua: navigator.userAgent,
        events: batch,
      });
      try {
        if (useBeacon && navigator.sendBeacon) {
          navigator.sendBeacon(endpoint(), new Blob([payload], { type: "application/json" }));
          return;
        }
      } catch (e) {}
      sending = true;
      fetch(endpoint(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      })
        .catch(function () {})
        .finally(function () {
          sending = false;
        });
    }

    function startRecording() {
      if (window.__REPLICA_RECORDING__) return;
      window.rrweb.record({
        emit: function (event) {
          buffer.push(event);
        },
        // Mai registrare le password in chiaro.
        maskInputOptions: { password: true },
        maskAllInputs: false,
        recordCanvas: false,
        collectFonts: false,
        sampling: { mousemove: 50, scroll: 100, input: "last" },
      });
      window.__REPLICA_RECORDING__ = sid;
    }

    // Avvia dopo il rendering (anche delle SPA con moduli differiti), così lo
    // snapshot iniziale contiene la pagina già composta.
    if (document.readyState === "complete") {
      setTimeout(startRecording, 0);
    } else {
      window.addEventListener("load", function () {
        setTimeout(startRecording, 0);
      });
    }

    // Invio periodico + agli eventi di uscita pagina.
    setInterval(function () {
      if (!sending) flush(false);
    }, 800);
    window.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush(true);
    });
    window.addEventListener("pagehide", function () {
      flush(true);
    });
    window.addEventListener("beforeunload", function () {
      flush(true);
    });
  } catch (e) {
    try { window.__REPLICA_RECORD_ERROR__ = String(e); } catch (_) {}
  }
})();
