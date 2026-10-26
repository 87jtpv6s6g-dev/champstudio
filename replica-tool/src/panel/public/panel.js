/* UI del pannello: stato via /api, aggiornamenti live via SSE. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const linksCache = {};
  let state = { domains: [], builds: [], sessions: [], networkHost: "127.0.0.1" };
  const sessionActivity = {}; // sessionId -> last event ts (per badge "live")

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]),
    );
  }

  async function api(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers["content-type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    const r = await fetch(url, opt);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  /* ---------- domini ---------- */
  function renderDomains() {
    const el = $("#domains-list");
    if (!state.domains.length) {
      el.innerHTML = '<div class="empty">Nessun dominio consentito. Aggiungine uno per iniziare.</div>';
      return;
    }
    el.innerHTML = state.domains
      .map(
        (h) =>
          `<span class="chip domain-item" data-host="${esc(h)}">${esc(h)}` +
          `<button class="domain-remove" data-host="${esc(h)}" title="Rimuovi">✕</button></span>`,
      )
      .join("");
  }

  async function addDomain() {
    const inp = $("#domain-input");
    const host = inp.value.trim();
    if (!host) return;
    const d = await api("POST", "/api/domains", { host });
    state.domains = d.domains;
    inp.value = "";
    renderDomains();
  }

  async function removeDomain(host) {
    const d = await api("DELETE", "/api/domains/" + encodeURIComponent(host));
    state.domains = d.domains;
    renderDomains();
  }

  /* ---------- replica ---------- */
  async function replicate() {
    const inp = $("#url-input");
    const url = inp.value.trim();
    const msg = $("#replicate-msg");
    msg.textContent = "";
    if (!url) return;
    try {
      const r = await api("POST", "/api/replicate", { url });
      msg.textContent = "Replica avviata (" + r.buildId + ")…";
      log("avvio", "Replica avviata per " + url, "info");
      await refreshState();
    } catch (e) {
      msg.textContent = "Errore: " + e.message;
    }
  }

  /* ---------- progress log ---------- */
  function log(phase, message, level) {
    const box = $("#progress");
    const line = document.createElement("div");
    line.className = "l-" + (level || "info");
    const t = new Date().toLocaleTimeString();
    line.textContent = `[${t}] ${phase ? phase + ": " : ""}${message}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- builds ---------- */
  async function renderBuilds() {
    const el = $("#builds");
    if (!state.builds.length) {
      el.innerHTML = '<div class="empty">Nessuna replica ancora.</div>';
      return;
    }
    const parts = [];
    for (const b of state.builds) {
      const verify = b.stats && b.stats.verify;
      let linksHtml = "";
      if (b.status === "ready" && b.port) {
        const links = await getLinks(b.id);
        linksHtml =
          `<div class="links">` +
          `<div class="linkcol"><span class="muted">Computer</span>` +
          `<a class="local-link" href="${esc(links.localUrl)}" target="_blank" rel="noopener">${esc(links.localUrl)}</a></div>` +
          `<div class="linkcol"><span class="muted">Telefono (stessa Wi-Fi)</span>` +
          `<a class="network-link" href="${esc(links.networkUrl)}" target="_blank" rel="noopener">${esc(links.networkUrl)}</a></div>` +
          (links.qr ? `<div class="qr"><img class="qr-img" alt="QR" src="${esc(links.qr)}"></div>` : "") +
          `</div>`;
      }
      let verifyHtml = "";
      if (verify) {
        verifyHtml =
          `<div class="verify"><ul>` +
          verify.details.map((d) => `<li>${esc(d)}</li>`).join("") +
          `</ul><div class="verify-images">` +
          (verify.images || [])
            .map(
              (im) =>
                `<figure><img src="/api/artifacts/${esc(im.path)}" alt="${esc(im.label)}">` +
                `<figcaption>${esc(im.label)}</figcaption></figure>`,
            )
            .join("") +
          `</div></div>`;
      }
      const stats = b.stats || {};
      parts.push(
        `<div class="build" data-build="${esc(b.id)}" data-status="${esc(b.status)}" data-verdict="${esc(b.verdict)}">` +
          `<div class="top"><span class="url">${esc(b.url)}</span>` +
          `<span class="badge status">${esc(b.status)}</span>` +
          (b.verdict && b.verdict !== "n/d"
            ? `<span class="badge verdict-badge ${esc(b.verdict)}">${esc(b.verdict)}</span>`
            : "") +
          `</div>` +
          `<div class="stats">pagine: ${stats.pages ?? "–"} · risorse: ${stats.assets ?? "–"} · ` +
          `${stats.bytes ? Math.round(stats.bytes / 1024) + " KB" : "–"}</div>` +
          (b.error ? `<div class="stats l-error" style="color:var(--err)">${esc(b.error.split("\n")[0])}</div>` : "") +
          linksHtml +
          verifyHtml +
          `</div>`,
      );
    }
    el.innerHTML = parts.join("");
  }

  async function getLinks(id) {
    if (linksCache[id]) return linksCache[id];
    const l = await api("GET", "/api/builds/" + id + "/links").catch(() => ({}));
    linksCache[id] = l;
    return l;
  }

  /* ---------- sessioni ---------- */
  function renderSessions() {
    const el = $("#sessions");
    if (!state.sessions.length) {
      el.innerHTML = '<div class="empty">Nessuna sessione registrata.</div>';
      return;
    }
    const now = Date.now();
    el.innerHTML = state.sessions
      .map((s) => {
        const live = (sessionActivity[s.id] || s.last_at) > now - 8000;
        return (
          `<div class="session" data-session="${esc(s.id)}">` +
          (live ? `<span class="live-badge">● LIVE</span>` : "") +
          `<a class="replay-link" href="/sessions/${esc(s.id)}" target="_blank" rel="noopener">Replay ${esc(s.id)}</a>` +
          `<span class="meta">eventi: ${s.event_count} · ${esc((s.ua || "").slice(0, 48))}</span>` +
          `</div>`
        );
      })
      .join("");
  }

  async function refreshState() {
    state = await api("GET", "/api/state");
    $("#net-tag").textContent = "rete: " + state.networkHost;
    renderDomains();
    renderSessions();
    await renderBuilds();
  }

  async function refreshSessions() {
    const d = await api("GET", "/api/sessions").catch(() => null);
    if (d) {
      state.sessions = d.sessions;
      renderSessions();
    }
  }

  /* ---------- SSE ---------- */
  function connectSSE() {
    const es = new EventSource("/events");
    es.onmessage = (e) => {
      let ev;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.kind === "build") {
        const d = ev.data || {};
        if (d.message) log(d.phase, d.message, d.level);
        if (d.done) {
          delete linksCache[ev.buildId];
          refreshState();
        } else {
          scheduleBuildRefresh();
        }
      } else if (ev.kind === "session") {
        sessionActivity[ev.sessionId] = Date.now();
        refreshSessions();
      } else if (ev.kind === "sessions-changed") {
        refreshSessions();
      }
    };
    es.onerror = () => {
      /* EventSource riprova da solo */
    };
  }

  let buildRefreshTimer = null;
  function scheduleBuildRefresh() {
    if (buildRefreshTimer) return;
    buildRefreshTimer = setTimeout(async () => {
      buildRefreshTimer = null;
      const d = await api("GET", "/api/builds").catch(() => null);
      if (d) {
        state.builds = d.builds;
        await renderBuilds();
      }
    }, 400);
  }

  /* ---------- eventi UI ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.id === "domain-add") addDomain();
    else if (t.id === "replicate-btn") replicate();
    else if (t.classList && t.classList.contains("domain-remove")) removeDomain(t.dataset.host);
  });
  $("#domain-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addDomain();
  });
  $("#url-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") replicate();
  });

  refreshState().catch((e) => log("errore", e.message, "error"));
  connectSSE();
  // aggiornamento periodico leggero del badge live
  setInterval(renderSessions, 3000);
})();
