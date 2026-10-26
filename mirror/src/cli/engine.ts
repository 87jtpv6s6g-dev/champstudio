import type { BuildOptions, Report } from "../schemas/index.js";

export class NotImplementedError extends Error {
  constructor(stage: string) {
    super(`stage not implemented yet: ${stage}`);
    this.name = "NotImplementedError";
  }
}

export interface BuildResult {
  outDir: string;
  report: Report;
}

/**
 * Orchestrates the full pipeline:
 *   capture -> explore -> archive -> transform -> mock -> package -> verify
 * Returns the output directory and the verify Report.
 *
 * M0: deliberately unimplemented. The e2e suite runs this against the trap
 * fixtures and asserts the done-criteria pass; it therefore fails now, which
 * is the proof that the e2e harness measures real behaviour and not a stub
 * that always reports success.
 */
export async function buildMirror(_opts: BuildOptions): Promise<BuildResult> {
  throw new NotImplementedError("capture");
}
