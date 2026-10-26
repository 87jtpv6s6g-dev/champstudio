import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpyServer } from "../../src/report/spy-server.js";
import { buildMirror } from "../../src/cli/engine.js";
import { evaluateDoneCriteria } from "../../src/report/criteria.js";
import { loadFixtures, serveFixture } from "../support/fixtures.js";

/**
 * For every trap fixture: serve the original, build the mirror, then assert
 * EVERY done-criterion passes AND the spy saw zero external requests.
 *
 * Until the engine is implemented (M1+), buildMirror throws and these fail.
 * That red is intentional — it proves the harness measures real behaviour.
 */
const fixtures = loadFixtures();

describe("e2e: mirror fidelity over trap fixtures", () => {
  it("discovers the full trap set (16 traps + baseline)", () => {
    const traps = new Set(fixtures.map((f) => f.desc.trap));
    for (let i = 0; i <= 16; i++) {
      expect(traps.has(i), `missing fixture for trap #${i}`).toBe(true);
    }
  });

  for (const fx of fixtures) {
    it(`${fx.desc.name} (trap #${fx.desc.trap}) satisfies all done-criteria`, async () => {
      const spy = new SpyServer();
      await spy.listen();
      const site = await serveFixture(fx, spy.origin);
      const out = await mkdtemp(join(tmpdir(), `mirror-out-${fx.desc.name}-`));
      try {
        let report;
        try {
          const result = await buildMirror({
            url: site.origin,
            out,
            maxPages: 50,
            lan: false,
            record: true,
          });
          report = result.report;
        } catch (e) {
          // M0: engine is a stub. Surface it as a criterion failure, not a crash.
          expect.fail(`engine did not produce a mirror: ${(e as Error).message}`);
          return;
        }
        const { passed, failures } = evaluateDoneCriteria(report, spy.hits.length);
        expect(failures.join("\n") || "<none>").toBe("<none>");
        expect(passed).toBe(true);
      } finally {
        await site.close();
        await spy.close();
      }
    });
  }
});
