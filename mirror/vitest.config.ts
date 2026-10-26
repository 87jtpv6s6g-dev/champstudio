import { defineConfig } from "vitest/config";

// Unit + property tests only. The e2e fixtures run under vitest.e2e.config.ts
// so that `pnpm test` stays fast and never touches the network.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    reporters: "default",
  },
});
