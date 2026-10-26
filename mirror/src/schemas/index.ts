import { z } from "zod";

/**
 * Schema version embedded in every manifest/graph/report artifact.
 * Bump on any breaking change to the contracts below.
 */
export const SCHEMA_VERSION = 1 as const;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export const Sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected lowercase hex sha256");

export const Viewport = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive().default(1),
  isMobile: z.boolean().default(false),
  label: z.string().min(1), // e.g. "desktop", "mobile", "bp-768"
});
export type Viewport = z.infer<typeof Viewport>;

export const ResourceType = z.enum([
  "document",
  "stylesheet",
  "script",
  "image",
  "font",
  "media",
  "xhr",
  "fetch",
  "websocket",
  "eventsource",
  "manifest",
  "other",
]);
export type ResourceType = z.infer<typeof ResourceType>;

/* ------------------------------------------------------------------ */
/* Archive / manifest                                                  */
/* ------------------------------------------------------------------ */

export const Blob = z.object({
  sha256: Sha256,
  bytes: z.number().int().nonnegative(),
  mime: z.string().min(1),
});
export type Blob = z.infer<typeof Blob>;

export const ResourceRecord = z.object({
  url: z.string().url(),
  finalUrl: z.string().url(), // after following redirects
  method: z.string().min(1),
  status: z.number().int(),
  reqHeaders: z.record(z.string()),
  respHeaders: z.record(z.string()),
  mime: z.string(),
  resourceType: ResourceType,
  initiator: z.string(), // "parser" | "script" | "preload" | url of initiator
  blobSha: Sha256.nullable(), // null for redirects / bodiless responses
  fromCache: z.boolean().default(false),
  page: z.string(), // PageId that triggered the load
  state: z.string(), // StateId active when loaded
  essential: z.boolean(), // decided by CSS/JS coverage
});
export type ResourceRecord = z.infer<typeof ResourceRecord>;

export const ApiRecord = z.object({
  urlPattern: z.string().min(1),
  method: z.string().min(1),
  status: z.number().int(),
  respHeaders: z.record(z.string()),
  blobSha: Sha256.nullable(),
  matchedBy: z.enum(["exact", "pathname", "pattern"]),
});
export type ApiRecord = z.infer<typeof ApiRecord>;

export const ExcludedRecord = z.object({
  url: z.string(),
  rule: z.string(), // which exclusion rule fired (anti-bot, analytics, ...)
});
export type ExcludedRecord = z.infer<typeof ExcludedRecord>;

export const Manifest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  origin: z.string().url(),
  capturedAt: z.string().datetime(),
  chromiumVersion: z.string(),
  resources: z.array(ResourceRecord),
  apis: z.array(ApiRecord),
  excluded: z.array(ExcludedRecord),
});
export type Manifest = z.infer<typeof Manifest>;

/* ------------------------------------------------------------------ */
/* Explore / state graph                                               */
/* ------------------------------------------------------------------ */

export const ActionKind = z.enum([
  "click",
  "hover",
  "focus",
  "active",
  "open",
  "nav",
  "scroll",
]);
export type ActionKind = z.infer<typeof ActionKind>;

export const Action = z.object({
  kind: ActionKind,
  /** Selector used BOTH to detect and to interact (trap #7 invariant). */
  selector: z.string(),
  note: z.string().default(""),
});
export type Action = z.infer<typeof Action>;

export const StateNode = z.object({
  stateId: z.string(), // hash(ariaSnapshot + route + viewport)
  route: z.string(),
  viewport: z.string(), // Viewport.label
  ariaSnapshot: z.string(),
  screenshotSha: Sha256.nullable(),
});
export type StateNode = z.infer<typeof StateNode>;

export const Edge = z.object({
  from: z.string(),
  to: z.string(),
  action: Action,
});
export type Edge = z.infer<typeof Edge>;

export const StateGraph = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  nodes: z.array(StateNode),
  edges: z.array(Edge),
  routes: z.array(z.string()),
  breakpoints: z.array(z.number().int().positive()),
});
export type StateGraph = z.infer<typeof StateGraph>;

/* ------------------------------------------------------------------ */
/* Mock / simulated backend                                            */
/* ------------------------------------------------------------------ */

export const ProviderKind = z.enum([
  "own",
  "supabase",
  "firebase",
  "unknown",
]);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const ProviderProfile = z.object({
  kind: ProviderKind,
  loginError: z.object({
    status: z.number().int(),
    headers: z.record(z.string()),
    bodyTemplate: z.string(), // native provider error body (JSON string)
  }),
  formSuccess: z.object({
    status: z.number().int(),
    headers: z.record(z.string()),
    bodyTemplate: z.string(),
  }),
});
export type ProviderProfile = z.infer<typeof ProviderProfile>;

/* ------------------------------------------------------------------ */
/* Verify / report                                                     */
/* ------------------------------------------------------------------ */

export const StyleDiff = z.object({
  selector: z.string(),
  property: z.string(),
  original: z.string(),
  mirror: z.string(),
  allowlisted: z.boolean(),
  reason: z.string().default(""), // required when allowlisted
});
export type StyleDiff = z.infer<typeof StyleDiff>;

export const VerifyCell = z.object({
  route: z.string(),
  viewport: z.string(),
  state: z.string(),
  pixelDiffPct: z.number().min(0).max(100),
  ariaEqual: z.boolean(),
  styleDiffs: z.array(StyleDiff),
  behaviorOk: z.boolean(),
  jsErrorsNew: z.number().int().nonnegative(),
  missingEssential: z.number().int().nonnegative(),
  verdict: z.enum(["pronta", "da rivedere", "fallita"]),
});
export type VerifyCell = z.infer<typeof VerifyCell>;

export const VerifyRun = z.object({
  withServiceWorker: z.boolean(),
  externalRequests: z.number().int().nonnegative(),
  cells: z.array(VerifyCell),
});
export type VerifyRun = z.infer<typeof VerifyRun>;

export const Report = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  origin: z.string().url(),
  runs: z.array(VerifyRun), // [withSW, withoutSW] — must agree
  final: z.enum(["pronta", "da rivedere", "fallita"]),
});
export type Report = z.infer<typeof Report>;

/* ------------------------------------------------------------------ */
/* Record / panel                                                      */
/* ------------------------------------------------------------------ */

export const SessionMeta = z.object({
  id: z.string(),
  device: z.string(),
  viewport: Viewport,
  ua: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime().nullable(),
  routes: z.array(z.string()),
  loginAttempts: z.number().int().nonnegative(),
  formsSubmitted: z.number().int().nonnegative(),
  jsErrors: z.number().int().nonnegative(),
});
export type SessionMeta = z.infer<typeof SessionMeta>;

/* ------------------------------------------------------------------ */
/* CLI build options                                                   */
/* ------------------------------------------------------------------ */

export const BuildOptions = z.object({
  url: z.string().url(),
  port: z.number().int().min(1).max(65535).optional(),
  out: z.string().optional(),
  maxPages: z.number().int().positive().default(50),
  lan: z.boolean().default(false),
  record: z.boolean().default(true),
});
export type BuildOptions = z.infer<typeof BuildOptions>;
