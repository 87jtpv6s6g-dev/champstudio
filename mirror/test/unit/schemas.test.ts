import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  SCHEMA_VERSION,
  Manifest,
  StateGraph,
  Report,
  Viewport,
  Blob,
} from "../../src/schemas/index.js";

describe("schema round-trips", () => {
  it("accepts a minimal valid manifest and round-trips through JSON", () => {
    const m = {
      schemaVersion: SCHEMA_VERSION,
      origin: "https://example.test",
      capturedAt: new Date().toISOString(),
      chromiumVersion: "1243",
      resources: [],
      apis: [],
      excluded: [],
    };
    const parsed = Manifest.parse(m);
    const again = Manifest.parse(JSON.parse(JSON.stringify(parsed)));
    expect(again).toEqual(parsed);
  });

  it("accepts a minimal valid state graph", () => {
    const g = StateGraph.parse({
      schemaVersion: SCHEMA_VERSION,
      nodes: [],
      edges: [],
      routes: ["/"],
      breakpoints: [768, 1024],
    });
    expect(g.routes).toContain("/");
  });

  it("accepts a minimal valid report", () => {
    const r = Report.parse({
      schemaVersion: SCHEMA_VERSION,
      origin: "https://example.test",
      runs: [],
      final: "fallita",
    });
    expect(r.final).toBe("fallita");
  });

  it("rejects a manifest with the wrong schema version", () => {
    expect(() =>
      Manifest.parse({
        schemaVersion: 999,
        origin: "https://example.test",
        capturedAt: new Date().toISOString(),
        chromiumVersion: "x",
        resources: [],
        apis: [],
        excluded: [],
      }),
    ).toThrow();
  });

  it("rejects a non-hex blob sha", () => {
    expect(() => Blob.parse({ sha256: "zzzz", bytes: 1, mime: "text/plain" })).toThrow();
  });
});

describe("Viewport property: parse(serialize(x)) === x", () => {
  it("holds for arbitrary valid viewports", () => {
    const arb = fc.record({
      width: fc.integer({ min: 1, max: 4000 }),
      height: fc.integer({ min: 1, max: 4000 }),
      deviceScaleFactor: fc.double({ min: 0.5, max: 4, noNaN: true }),
      isMobile: fc.boolean(),
      label: fc.string({ minLength: 1, maxLength: 20 }),
    });
    fc.assert(
      fc.property(arb, (v) => {
        const parsed = Viewport.parse(v);
        const again = Viewport.parse(JSON.parse(JSON.stringify(parsed)));
        expect(again).toEqual(parsed);
      }),
    );
  });
});
