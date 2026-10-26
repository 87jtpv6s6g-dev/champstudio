/*
 * isolation.js — iniettato PER PRIMO nel <head> di ogni pagina della replica.
 * Garantisce l'AUTONOMIA: la replica non effettua alcuna richiesta verso l'origine
 * reale o servizi esterni. Riporta sulla replica link, pulsanti, router, window.open,
 * fetch, XHR, sendBeacon, WebSocket, EventSource. Risponde ai form (errore di login /
 * conferma di invio). Disattiva il service worker originale del sito.
 *
 * Non deve MAI lanciare eccezioni né bloccare il rendering: tutto in try/catch.
 * Legge il manifest da window.__REPLICA__ (iniettato prima di questo script):
 *   { id, origin, assets: string[] }  // assets = percorsi catturati, root-relative
 */
(function () {
  "use strict";
  try {
    var R = window.__REPLICA__ || { id: "", origin: "", assets: [] };
    var ASSETS = new Set(R.assets || []);
    var LOC = window.location;

    function sameOrigin(u) {
      try {
        var url = new URL(u, LOC.href);
        return url.host === LOC.host && url.protocol === LOC.protocol;
      } catch (e) {
        // URL relativo non parsabile → trattalo come interno
        return true;
      }
    }

    function pathOf(u) {
      try {
        return new URL(u, LOC.href).pathname;
      } catch (e) {
        return typeof u === "string" ? u.split("?")[0] : "/";
      }
    }

    // Una richiesta same-origin è "reale" se punta a un asset catturato o al canale
    // interno del mirror; altrimenti è una chiamata dinamica (API) da neutralizzare.
    function isServable(u) {
      if (!sameOrigin(u)) return false;
      var p = pathOf(u);
      if (p.indexOf("/__mirror/") === 0) return true;
      if (ASSETS.has(p)) return true;
      // file statico con estensione (es. .js .css .png .woff2 .mp3) → servito dalla replica
      if (/\.[a-z0-9]{1,8}$/i.test(p)) return true;
      return false;
    }

    function syntheticResponse() {
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    var blocked = [];
    window.__REPLICA_BLOCKED__ = blocked;
    function note(kind, u) {
      try {
        blocked.push({ kind: kind, url: String(u), t: Date.now() });
      } catch (e) {}
    }

    /* ---------- fetch ---------- */
    var realFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = function (input, init) {
      try {
        var u = typeof input === "string" ? input : input && input.url ? input.url : String(input);
        if (isServable(u)) return realFetch(input, init);
        note("fetch", u);
        return Promise.resolve(syntheticResponse());
      } catch (e) {
        return Promise.resolve(syntheticResponse());
      }
    };

    /* ---------- XMLHttpRequest ---------- */
    var RealXHR = window.XMLHttpRequest;
    if (RealXHR) {
      var XHRProxy = function () {
        var xhr = new RealXHR();
        var _url = "";
        var _stub = false;
        var open = xhr.open;
        xhr.open = function (method, url) {
          _url = url;
          _stub = !isServable(url);
          if (_stub) {
            note("xhr", url);
            // non apriamo nessuna connessione reale verso l'esterno
            return;
          }
          return open.apply(xhr, arguments);
        };
        var send = xhr.send;
        xhr.send = function () {
          if (_stub) {
            // simula una risposta 200 vuota, in modo asincrono
            setTimeout(function () {
              try {
                Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
                Object.defineProperty(xhr, "status", { value: 200, configurable: true });
                Object.defineProperty(xhr, "responseText", { value: "{}", configurable: true });
                Object.defineProperty(xhr, "response", { value: "{}", configurable: true });
                if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange(new Event("readystatechange"));
                xhr.dispatchEvent(new Event("readystatechange"));
                xhr.dispatchEvent(new Event("load"));
                xhr.dispatchEvent(new Event("loadend"));
              } catch (e) {}
            }, 0);
            return;
          }
          return send.apply(xhr, arguments);
        };
        return xhr;
      };
      window.XMLHttpRequest = XHRProxy;
    }

    /* ---------- sendBeacon ---------- */
    if (navigator.sendBeacon) {
      var realBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (url, data) {
        try {
          if (isServable(url)) return realBeacon(url, data);
          note("beacon", url);
          return true;
        } catch (e) {
          return true;
        }
      };
    }

    /* ---------- WebSocket / EventSource ---------- */
    function DummyWS() {
      this.readyState = 3;
      this.close = function () {};
      this.send = function () {};
      this.addEventListener = function () {};
      this.removeEventListener = function () {};
    }
    var RealWS = window.WebSocket;
    if (RealWS) {
      window.WebSocket = function (url) {
        if (sameOrigin(url)) return new RealWS(url);
        note("websocket", url);
        return new DummyWS();
      };
    }
    var RealES = window.EventSource;
    if (RealES) {
      window.EventSource = function (url, cfg) {
        if (sameOrigin(url) && pathOf(url).indexOf("/__mirror/") !== 0) return new RealES(url, cfg);
        if (sameOrigin(url)) return new RealES(url, cfg);
        note("eventsource", url);
        return new DummyWS();
      };
    }

    /* ---------- window.open ---------- */
    var realOpen = window.open ? window.open.bind(window) : null;
    window.open = function (url) {
      try {
        if (url && !sameOrigin(url)) {
          note("window.open", url);
          return null;
        }
        return realOpen ? realOpen.apply(window, arguments) : null;
      } catch (e) {
        return null;
      }
    };

    /* ---------- service worker ---------- */
    try {
      if (navigator.serviceWorker) {
        navigator.serviceWorker.register = function () {
          note("serviceWorker.register", "(disattivato)");
          return Promise.resolve({ unregister: function () { return Promise.resolve(true); } });
        };
        if (navigator.serviceWorker.getRegistrations) {
          navigator.serviceWorker.getRegistrations().then(function (rs) {
            (rs || []).forEach(function (r) { try { r.unregister(); } catch (e) {} });
          }).catch(function () {});
        }
      }
    } catch (e) {}

    /* ---------- link e navigazioni esterne ---------- */
    document.addEventListener(
      "click",
      function (e) {
        try {
          var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
          if (!a) return;
          var href = a.getAttribute("href");
          if (!href || href[0] === "#") return;
          if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
          if (!sameOrigin(href)) {
            e.preventDefault();
            e.stopPropagation();
            note("link", href);
          }
        } catch (err) {}
      },
      true,
    );

    /* ---------- form: login simulato / conferma invio ---------- */
    function showFormMessage(form, ok, text) {
      try {
        var box = form.querySelector("[data-replica-msg]");
        if (!box) {
          box = document.createElement("div");
          box.setAttribute("data-replica-msg", "");
          box.style.marginTop = "12px";
          box.style.padding = "10px 12px";
          box.style.borderRadius = "8px";
          box.style.fontSize = "14px";
          box.style.fontFamily = "inherit";
          form.appendChild(box);
        }
        box.style.background = ok ? "#e7f6ec" : "#fdecec";
        box.style.color = ok ? "#1b5e20" : "#b00020";
        box.style.border = "1px solid " + (ok ? "#a5d6a7" : "#f5c2c2");
        box.textContent = text;
        box.setAttribute("role", ok ? "status" : "alert");
      } catch (e) {}
    }

    document.addEventListener(
      "submit",
      function (e) {
        try {
          var form = e.target;
          if (!form || form.tagName !== "FORM") return;
          // Durante la replica NON si inviano MAI dati reali.
          e.preventDefault();
          e.stopPropagation();
          var isLogin = !!form.querySelector('input[type="password"]');
          if (isLogin) {
            showFormMessage(
              form,
              false,
              "Credenziali non valide. Controlla email e password: l'account potrebbe non essere registrato.",
            );
          } else {
            showFormMessage(
              form,
              true,
              "Messaggio inviato correttamente. Ti risponderemo al più presto.",
            );
          }
        } catch (err) {}
      },
      true,
    );

    window.__REPLICA_ISOLATION_READY__ = true;
  } catch (fatal) {
    // Mai propagare: l'isolamento non deve rompere la pagina.
    try { window.__REPLICA_ISOLATION_ERROR__ = String(fatal); } catch (e) {}
  }
})();
