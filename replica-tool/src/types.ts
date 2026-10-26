export type BuildStatus =
  | "queued"
  | "capturing"
  | "resolving"
  | "rewriting"
  | "serving"
  | "verifying"
  | "ready"
  | "failed";

/** Esito della verifica automatica di fine build. */
export type Verdict = "pronta" | "da-rivedere" | "fallita" | "n/d";

export interface BuildStats {
  pages?: number;
  assets?: number;
  bytes?: number;
  verify?: VerifyResult;
}

export interface VerifyResult {
  verdict: Verdict;
  failedRequests: number;
  newJsErrors: number;
  desktopDiffPct: number;
  mobileDiffPct: number;
  details: string[];
  /** Percorsi (relativi ad ARTIFACTS) delle immagini di differenza. */
  images: { label: string; path: string }[];
}

export interface BuildRecord {
  id: string;
  url: string;
  origin: string;
  host: string;
  status: BuildStatus;
  verdict: Verdict;
  port: number | null;
  created_at: number;
  updated_at: number;
  stats: BuildStats;
  error: string | null;
}

export interface SessionRecord {
  id: string;
  replica_id: string;
  started_at: number;
  last_at: number;
  ua: string;
  event_count: number;
}

export interface ProgressEvent {
  phase: string;
  message: string;
  level: "info" | "warn" | "error" | "success";
  ts: number;
}
