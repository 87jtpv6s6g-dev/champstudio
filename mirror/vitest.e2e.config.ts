import { defineConfig } from "vitest/config";

// End-to-end suite: runs the real engine over the trap fixtures and asserts
// EVERY "definition of done" criterion. These are expected to FAIL until the
// corresponding milestone is implemented — that failure is the proof the
// tests actually measure something.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: "default",
    // e2e must run serially: they bind real TCP ports (spy server, mirror serve).
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
