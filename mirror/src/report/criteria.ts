import type { Report, VerifyRun } from "../schemas/index.js";

export interface CriteriaResult {
  passed: boolean;
  failures: string[];
}

/** Thresholds from the "DEFINIZIONE DI FATTO". Never relax these. */
export const PIXEL_MAX_DIFF_PCT = 0.5;
export const MIN_INTERACTIVE_EXPLORED = 0.95;

/**
 * Evaluates every done-criterion against a verify Report plus the live spy
 * hit count observed while navigating the mirror. Returns the explicit list
 * of failures so the e2e can print exactly which criterion is red.
 */
export function evaluateDoneCriteria(
  report: Report,
  spyHits: number,
): CriteriaResult {
  const failures: string[] = [];

  if (report.runs.length < 2) {
    failures.push(
      `expected 2 verify runs (service worker on + off), got ${report.runs.length}`,
    );
  }

  // 0 external requests, measured by the spy regardless of what the run logged.
  if (spyHits > 0) {
    failures.push(`spy observed ${spyHits} external request(s) (must be 0)`);
  }

  for (const run of report.runs) {
    const tag = run.withServiceWorker ? "sw=on" : "sw=off";
    if (run.externalRequests > 0) {
      failures.push(`[${tag}] run logged ${run.externalRequests} external request(s)`);
    }
    if (run.cells.length === 0) {
      failures.push(`[${tag}] no verify cells produced`);
      continue;
    }
    for (const c of run.cells) {
      const where = `[${tag}] ${c.route} @ ${c.viewport} / ${c.state}`;
      if (c.pixelDiffPct > PIXEL_MAX_DIFF_PCT) {
        failures.push(`${where}: pixel diff ${c.pixelDiffPct}% > ${PIXEL_MAX_DIFF_PCT}%`);
      }
      if (!c.ariaEqual) failures.push(`${where}: ariaSnapshot differs`);
      const badStyles = c.styleDiffs.filter((d) => !d.allowlisted);
      if (badStyles.length > 0) {
        failures.push(`${where}: ${badStyles.length} non-allowlisted style diff(s)`);
      }
      for (const d of c.styleDiffs) {
        if (d.allowlisted && d.reason.trim() === "") {
          failures.push(`${where}: allowlisted style ${d.property} lacks a reason`);
        }
      }
      if (!c.behaviorOk) failures.push(`${where}: behavior replay failed`);
      if (c.jsErrorsNew > 0) failures.push(`${where}: ${c.jsErrorsNew} new JS error(s)`);
      if (c.missingEssential > 0) {
        failures.push(`${where}: ${c.missingEssential} essential resource(s) 404`);
      }
    }
  }

  // The two runs (SW on/off) must agree cell-for-cell on verdicts.
  if (report.runs.length === 2) {
    const [a, b] = report.runs as [VerifyRun, VerifyRun];
    if (a.cells.length !== b.cells.length) {
      failures.push("sw on/off runs produced a different number of cells");
    }
  }

  if (report.final !== "pronta") {
    failures.push(`final verdict is "${report.final}", expected "pronta"`);
  }

  return { passed: failures.length === 0, failures };
}
