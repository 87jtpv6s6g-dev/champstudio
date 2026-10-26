import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 180000,
    hookTimeout: 180000,
    fileParallelism: false,
    pool: "forks",
    reporters: ["verbose"],
    include: ["test/**/*.test.ts"],
  },
});
