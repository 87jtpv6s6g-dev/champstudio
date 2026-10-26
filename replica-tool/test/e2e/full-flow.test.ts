/*
 * Test end-to-end dell'INTERO flusso, dal pannello:
 *  1. inserisce il dominio consentito e l'URL del sito di prova nel pannello;
 *  2. avvia la replica e aspetta l'esito (verdetto "pronta");
 *  3. apre la replica in emulazione mobile tramite il LINK DI RETE, naviga fino al
 *     login, compila e invia (errore realistico);
 *  4. verifica che nel pannello la sessione compaia IN TEMPO REALE e che il replay si
 *     apra dal suo link permanente /sessions/<id>;
 *  5. controlla: spy server 0 richieste, 0 fallite, 0 errori JS nuovi, diff ≤ 1%,
 *     nessuna password salvata nel database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, devices, type Browser } from "playwright";
import { startTestSite, type TestSite } from "../fixtures/site.js";
import { startPanel, type PanelHandle } from "../../src/panel/server.js";
import { launchChromium } from "../../src/capture/browser.js";

let site: TestSite;
let panel: PanelHandle;
let browser: Browser;

const PW = "SegretaPassword_" + Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  site = await startTestSite();
  panel = await startPanel();
  browser = await launchChromium();
});

afterAll(async () => {
  await browser?.close().catch(() => {});
  await panel?.close().catch(() => {});
  await site?.close().catch(() => {});
});

async function panelApi(p: string): Promise<any> {
  const r = await fetch(panel.url.replace(/\/$/, "") + p);
  return r.json();
}

describe("flusso completo pannello → replica → sessione", () => {
  it("replica il sito di prova, è autonoma e registra la sessione dal telefono", async () => {
    const host = new URL(site.origin).host;

    /* ---------- 1. pannello: dominio consentito + URL ---------- */
    const panelCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const panelPage = await panelCtx.newPage();
    await panelPage.goto(panel.url, { waitUntil: "load" });

    await panelPage.fill("#domain-input", host);
    await panelPage.click("#domain-add");
    await panelPage.waitForSelector(`.domain-item[data-host="${host}"]`, { timeout: 10000 });

    await panelPage.fill("#url-input", site.origin + "/");
    await panelPage.click("#replicate-btn");

    /* ---------- 2. attesa esito (verdetto pronta) ---------- */
    const card = panelPage.locator(".build[data-build]").first();
    await card.waitFor({ timeout: 60000 });
    const buildId = await card.getAttribute("data-build");
    expect(buildId).toBeTruthy();

    await panelPage.waitForFunction(
      (id) => {
        const el = document.querySelector(`.build[data-build="${id}"]`);
        return el && el.getAttribute("data-status") === "ready";
      },
      buildId,
      { timeout: 120000 },
    );

    const verdict = await panelPage
      .locator(`.build[data-build="${buildId}"]`)
      .getAttribute("data-verdict");
    expect(verdict).toBe("pronta");

    // numeri di verifica dal database tramite API
    const buildInfo = await panelApi(`/api/builds/${buildId}`);
    const v = buildInfo.build.stats.verify;
    expect(v.failedRequests).toBe(0);
    expect(v.newJsErrors).toBe(0);
    expect(v.desktopDiffPct).toBeLessThanOrEqual(1);
    expect(v.mobileDiffPct).toBeLessThanOrEqual(1);

    /* ---------- link di rete + QR nel pannello ---------- */
    const networkUrl = await panelPage
      .locator(`.build[data-build="${buildId}"] a.network-link`)
      .getAttribute("href");
    expect(networkUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(
      await panelPage.locator(`.build[data-build="${buildId}"] img.qr-img`).count(),
    ).toBe(1);

    /* ---------- 3. apertura dal "telefono" (emulazione mobile) ---------- */
    site.resetSpies(); // da ora in poi la replica non deve toccare origine/CDN

    const phone = await browser.newContext({ ...devices["iPhone 13"] });
    const phonePage = await phone.newPage();
    const phoneErrors: string[] = [];
    phonePage.on("pageerror", (e) => phoneErrors.push(String(e.message)));

    await phonePage.goto(networkUrl!, { waitUntil: "load" });
    await phonePage.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    await phonePage.waitForSelector("h1.hero", { timeout: 10000 });
    expect((await phonePage.locator("h1.hero").textContent())?.trim()).toBe(
      "Il mio sito di prova",
    );

    // vai all'area riservata (pulsante → pushState → import dinamico)
    await phonePage.click("#area");
    await phonePage.waitForSelector("#login", { timeout: 10000 });

    // compila e invia → errore realistico di credenziali
    await phonePage.fill('#login input[name="email"]', "mario@example.com");
    await phonePage.fill('#login input[name="password"]', PW);
    await phonePage.click('#login button[type="submit"]');
    const msg = phonePage.locator("[data-replica-msg]");
    await msg.waitFor({ timeout: 10000 });
    expect((await msg.textContent())?.toLowerCase()).toContain("credenziali non valide");

    // refresh diretto su route interna (/login) → deve funzionare (fallback SPA)
    await phonePage.reload({ waitUntil: "load" });
    await phonePage.waitForSelector("#login", { timeout: 10000 });
    expect(new URL(phonePage.url()).pathname).toBe("/login");

    await phonePage.waitForTimeout(1500); // lascia inviare gli eventi rrweb

    /* ---------- 4. la sessione compare nel pannello in tempo reale ---------- */
    await panelPage.waitForSelector("#sessions .session[data-session]", { timeout: 20000 });
    const sessionId = await panelPage
      .locator("#sessions .session[data-session]")
      .first()
      .getAttribute("data-session");
    expect(sessionId).toBeTruthy();

    // link permanente del replay
    const replayHref = await panelPage
      .locator(`.session[data-session="${sessionId}"] a.replay-link`)
      .getAttribute("href");
    expect(replayHref).toBe(`/sessions/${sessionId}`);

    // il replay si apre e rrweb-player si inizializza
    const replayPage = await panelCtx.newPage();
    await replayPage.goto(panel.url.replace(/\/$/, "") + replayHref!, { waitUntil: "load" });
    await replayPage.waitForSelector(".rr-player, #player iframe", { timeout: 20000 });

    /* ---------- 5. controlli finali di autonomia e privacy ---------- */
    await phone.close();

    expect(site.main.requests, "l'origine non deve ricevere richieste dalla replica").toHaveLength(0);
    expect(site.cdn.requests, "la CDN esterna non deve ricevere richieste dalla replica").toHaveLength(0);
    expect(phoneErrors, "nessun errore JS nella navigazione della replica").toHaveLength(0);

    // nessuna password salvata nel database (rrweb maschera i campi password)
    const evData = await panelApi(`/api/sessions/${sessionId}/events`);
    expect(evData.events.length).toBeGreaterThan(1);
    expect(JSON.stringify(evData.events)).not.toContain(PW);

    // riepilogo misurato (finisce in EVIDENCE/test-output.txt)
    console.log("\n──────── ESITO MISURATO ────────");
    console.log(`verdetto build ............. ${verdict}`);
    console.log(`richieste fallite .......... ${v.failedRequests}`);
    console.log(`errori JS nuovi ............ ${v.newJsErrors}`);
    console.log(`diff screenshot desktop .... ${v.desktopDiffPct}%`);
    console.log(`diff screenshot mobile ..... ${v.mobileDiffPct}%`);
    console.log(`spy origine (richieste) .... ${site.main.requests.length}`);
    console.log(`spy CDN esterna (richieste)  ${site.cdn.requests.length}`);
    console.log(`errori JS nella replica .... ${phoneErrors.length}`);
    console.log(`sessione registrata ........ ${sessionId} (${evData.events.length} eventi)`);
    console.log(`password nel database ...... ${JSON.stringify(evData.events).includes(PW) ? "PRESENTE ❌" : "assente ✅"}`);
    console.log("────────────────────────────────\n");

    await replayPage.close();
    await panelCtx.close();
  });
});
