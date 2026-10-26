/**
 * Manager: orchestra il ciclo di vita di una replica dentro il processo del pannello.
 * incolli URL → valida dominio → cattura → serve alla radice di una porta → verifica →
 * pronta. Mantiene la mappa delle repliche attive e genera link + QR.
 */
import os from "node:os";
import fs from "node:fs";
import QRCode from "qrcode";
import { builds, domains } from "../db/index.js";
import { bus } from "../bus.js";
import { captureAndBuild, loadMeta, type ReplicaMeta } from "../capture/index.js";
import { startReplicaServer, type RunningReplica } from "../replica/server.js";
import { verifyReplica } from "../verify/verify.js";
import { replicaDir } from "../config.js";
import path from "node:path";
import type { BuildRecord, Verdict } from "../types.js";

const running = new Map<string, RunningReplica>();

export function networkHost(): string {
  if (process.env.PANEL_NET_HOST) return process.env.PANEL_NET_HOST;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return "127.0.0.1";
}

export function hostAllowed(host: string): boolean {
  if (domains.has(host)) return true;
  // consenti anche host:porta se è consentito l'host senza porta e viceversa
  const bare = host.split(":")[0];
  return domains.has(bare);
}

function emitBuild(buildId: string, phase: string, message: string, level: any = "info") {
  builds.log(buildId, phase, level, message);
  bus.emitEvent({ kind: "build", buildId, data: { phase, message, level, ts: Date.now() } });
}

export interface ReplicaLinks {
  localUrl: string | null;
  networkUrl: string | null;
  qr: string | null;
}

export async function linksFor(buildId: string): Promise<ReplicaLinks> {
  const b = builds.get(buildId);
  if (!b || !b.port) return { localUrl: null, networkUrl: null, qr: null };
  const localUrl = `http://127.0.0.1:${b.port}/`;
  const netHost = networkHost();
  const networkUrl = `http://${netHost}:${b.port}/`;
  let qr: string | null = null;
  try {
    qr = await QRCode.toDataURL(networkUrl, { margin: 1, width: 220 });
  } catch {
    qr = null;
  }
  return { localUrl, networkUrl, qr };
}

/** Avvia (o riusa) il server della replica per una build. */
async function serve(meta: ReplicaMeta): Promise<RunningReplica> {
  const existing = running.get(meta.buildId);
  if (existing) return existing;
  const rep = await startReplicaServer(meta);
  running.set(meta.buildId, rep);
  builds.setPort(meta.buildId, rep.port);
  return rep;
}

export function replicaUrlLocal(buildId: string): string | null {
  const r = running.get(buildId);
  return r ? `http://127.0.0.1:${r.port}/` : null;
}

/** Pipeline completa, eseguita in background. */
async function pipeline(buildId: string, url: string): Promise<void> {
  try {
    const meta = await captureAndBuild(buildId, url);

    builds.setStatus(buildId, "serving");
    emitBuild(buildId, "replica", "Avvio del server della replica…");
    const rep = await serve(meta);
    emitBuild(buildId, "replica", `Replica servita sulla porta ${rep.port}`, "success");

    builds.setStatus(buildId, "verifying");
    emitBuild(buildId, "verifica", "Verifica con rete esterna bloccata…");
    const result = await verifyReplica({
      buildId,
      originUrl: url,
      replicaUrl: `http://127.0.0.1:${rep.port}/`,
    });
    builds.mergeStats(buildId, { verify: result });
    builds.setVerdict(buildId, result.verdict);
    for (const d of result.details) emitBuild(buildId, "verifica", d);
    emitBuild(
      buildId,
      "verifica",
      `Esito: ${result.verdict}`,
      result.verdict === "pronta" ? "success" : result.verdict === "fallita" ? "error" : "warn",
    );

    builds.setStatus(buildId, "ready");
    bus.emitEvent({ kind: "build", buildId, data: { phase: "fine", done: true, ts: Date.now() } });
  } catch (e: any) {
    const msg = e?.stack || e?.message || String(e);
    builds.setError(buildId, msg);
    emitBuild(buildId, "errore", msg, "error");
    bus.emitEvent({ kind: "build", buildId, data: { phase: "errore", done: true, error: msg, ts: Date.now() } });
  }
}

export interface StartResult {
  ok: boolean;
  buildId?: string;
  error?: string;
}

export function startReplication(rawUrl: string): StartResult {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, error: "URL non valido." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "Solo http/https." };
  }
  if (!hostAllowed(u.host)) {
    return {
      ok: false,
      error: `Dominio non consentito: ${u.host}. Aggiungilo tra i domini consentiti.`,
    };
  }
  const buildId =
    u.hostname.replace(/[^a-z0-9]/gi, "-") + "-" + Date.now().toString(36);
  builds.create({ id: buildId, url: u.toString(), origin: u.origin, host: u.host });
  emitBuild(buildId, "avvio", `Replica avviata per ${u.toString()}`);
  // esecuzione in background
  void pipeline(buildId, u.toString());
  return { ok: true, buildId };
}

/** Riavvia i server delle repliche già pronte (dopo un riavvio del pannello). */
export async function restoreReady(): Promise<void> {
  for (const b of builds.list(100)) {
    if (b.status === "ready" && !running.has(b.id)) {
      const metaFile = path.join(replicaDir(b.id), "meta.json");
      if (fs.existsSync(metaFile)) {
        try {
          await serve(loadMeta(b.id));
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export function listRunning(): string[] {
  return [...running.keys()];
}

export async function shutdown(): Promise<void> {
  for (const r of running.values()) await r.close().catch(() => {});
  running.clear();
}
