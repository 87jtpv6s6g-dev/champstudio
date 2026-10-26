import Database from "better-sqlite3";
import { DB_PATH, ensureDirs } from "../config.js";
import type {
  BuildRecord,
  BuildStats,
  BuildStatus,
  SessionRecord,
  Verdict,
} from "../types.js";

ensureDirs();

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS domains (
  host TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  origin TEXT NOT NULL,
  host TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT 'n/d',
  port INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  stats TEXT NOT NULL DEFAULT '{}',
  error TEXT
);

CREATE TABLE IF NOT EXISTS build_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  build_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  phase TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  replica_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  ua TEXT NOT NULL DEFAULT '',
  event_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  type INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_sessions_replica ON sessions(replica_id);
CREATE INDEX IF NOT EXISTS idx_logs_build ON build_logs(build_id, id);
`);

function rowToBuild(r: any): BuildRecord {
  return {
    id: r.id,
    url: r.url,
    origin: r.origin,
    host: r.host,
    status: r.status as BuildStatus,
    verdict: r.verdict as Verdict,
    port: r.port ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    stats: safeJson<BuildStats>(r.stats, {}),
    error: r.error ?? null,
  };
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/* ---------------- domini consentiti ---------------- */
export const domains = {
  list(): string[] {
    return (db.prepare("SELECT host FROM domains ORDER BY host").all() as any[]).map(
      (r) => r.host,
    );
  },
  add(host: string): void {
    db.prepare(
      "INSERT OR IGNORE INTO domains(host, added_at) VALUES (?, ?)",
    ).run(host, Date.now());
  },
  remove(host: string): void {
    db.prepare("DELETE FROM domains WHERE host = ?").run(host);
  },
  has(host: string): boolean {
    return !!db.prepare("SELECT 1 FROM domains WHERE host = ?").get(host);
  },
};

/* ---------------- build / repliche ---------------- */
export const builds = {
  create(b: {
    id: string;
    url: string;
    origin: string;
    host: string;
  }): BuildRecord {
    const now = Date.now();
    db.prepare(
      `INSERT INTO builds(id, url, origin, host, status, verdict, port, created_at, updated_at, stats, error)
       VALUES (@id, @url, @origin, @host, 'queued', 'n/d', NULL, @now, @now, '{}', NULL)`,
    ).run({ ...b, now });
    return builds.get(b.id)!;
  },
  get(id: string): BuildRecord | null {
    const r = db.prepare("SELECT * FROM builds WHERE id = ?").get(id);
    return r ? rowToBuild(r) : null;
  },
  list(limit = 50): BuildRecord[] {
    return (
      db
        .prepare("SELECT * FROM builds ORDER BY created_at DESC LIMIT ?")
        .all(limit) as any[]
    ).map(rowToBuild);
  },
  setStatus(id: string, status: BuildStatus): void {
    db.prepare("UPDATE builds SET status = ?, updated_at = ? WHERE id = ?").run(
      status,
      Date.now(),
      id,
    );
  },
  setPort(id: string, port: number): void {
    db.prepare("UPDATE builds SET port = ?, updated_at = ? WHERE id = ?").run(
      port,
      Date.now(),
      id,
    );
  },
  setVerdict(id: string, verdict: Verdict): void {
    db.prepare("UPDATE builds SET verdict = ?, updated_at = ? WHERE id = ?").run(
      verdict,
      Date.now(),
      id,
    );
  },
  setError(id: string, error: string): void {
    db.prepare(
      "UPDATE builds SET error = ?, status = 'failed', updated_at = ? WHERE id = ?",
    ).run(error, Date.now(), id);
  },
  mergeStats(id: string, patch: Partial<BuildStats>): void {
    const cur = builds.get(id);
    if (!cur) return;
    const merged = { ...cur.stats, ...patch };
    db.prepare("UPDATE builds SET stats = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(merged),
      Date.now(),
      id,
    );
  },
  log(id: string, phase: string, level: string, message: string): void {
    db.prepare(
      "INSERT INTO build_logs(build_id, ts, phase, level, message) VALUES (?,?,?,?,?)",
    ).run(id, Date.now(), phase, level, message);
  },
  logs(id: string): any[] {
    return db
      .prepare("SELECT ts, phase, level, message FROM build_logs WHERE build_id = ? ORDER BY id")
      .all(id) as any[];
  },
};

/* ---------------- sessioni / eventi rrweb ---------------- */
export const sessions = {
  upsert(id: string, replicaId: string, ua: string): void {
    const now = Date.now();
    const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(id);
    if (existing) {
      db.prepare("UPDATE sessions SET last_at = ?, ua = ? WHERE id = ?").run(
        now,
        ua,
        id,
      );
    } else {
      db.prepare(
        "INSERT INTO sessions(id, replica_id, started_at, last_at, ua, event_count) VALUES (?,?,?,?,?,0)",
      ).run(id, replicaId, now, now, ua);
    }
  },
  addEvents(
    sessionId: string,
    events: { type: number; timestamp: number; data: unknown }[],
  ): number {
    const now = Date.now();
    const insert = db.prepare(
      "INSERT INTO session_events(session_id, seq, ts, type, data) VALUES (?,?,?,?,?)",
    );
    const maxSeqRow = db
      .prepare("SELECT COALESCE(MAX(seq), -1) AS m FROM session_events WHERE session_id = ?")
      .get(sessionId) as any;
    let seq = (maxSeqRow?.m ?? -1) + 1;
    const tx = db.transaction(() => {
      for (const ev of events) {
        insert.run(sessionId, seq++, ev.timestamp ?? now, ev.type, JSON.stringify(ev));
      }
      db.prepare(
        "UPDATE sessions SET last_at = ?, event_count = event_count + ? WHERE id = ?",
      ).run(now, events.length, sessionId);
    });
    tx();
    return seq;
  },
  get(id: string): SessionRecord | null {
    const r = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
    return r ?? null;
  },
  list(replicaId?: string): SessionRecord[] {
    if (replicaId) {
      return db
        .prepare("SELECT * FROM sessions WHERE replica_id = ? ORDER BY started_at DESC")
        .all(replicaId) as any[];
    }
    return db.prepare("SELECT * FROM sessions ORDER BY started_at DESC").all() as any[];
  },
  events(id: string): unknown[] {
    return (
      db
        .prepare("SELECT data FROM session_events WHERE session_id = ? ORDER BY seq")
        .all(id) as any[]
    ).map((r) => JSON.parse(r.data));
  },
};
