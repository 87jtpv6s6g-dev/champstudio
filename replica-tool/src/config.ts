import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Radice del progetto replica-tool (una cartella sopra src/). */
export const ROOT = path.resolve(here, "..");

/** Prefisso opzionale per isolare i dati (usato dai test con una cartella temporanea). */
const DATA_ROOT = process.env.REPLICA_DATA_DIR
  ? path.resolve(process.env.REPLICA_DATA_DIR)
  : ROOT;

export const DATA_DIR = path.join(DATA_ROOT, ".data");
export const REPLICAS_DIR = path.join(DATA_ROOT, ".replicas");
export const ARTIFACTS_DIR = path.join(DATA_ROOT, ".artifacts");
export const DB_PATH = path.join(DATA_DIR, "replica-tool.db");

export const PANEL_HOST = "127.0.0.1";
export const PANEL_PORT = Number(process.env.PANEL_PORT ?? 7331);

/** Le repliche ascoltano su tutte le interfacce per essere raggiungibili dal telefono. */
export const REPLICA_BIND = "0.0.0.0";

export function ensureDirs(): void {
  for (const d of [DATA_DIR, REPLICAS_DIR, ARTIFACTS_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function replicaDir(buildId: string): string {
  return path.join(REPLICAS_DIR, buildId);
}

export function artifactDir(buildId: string): string {
  return path.join(ARTIFACTS_DIR, buildId);
}
