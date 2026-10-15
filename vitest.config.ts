import { defineConfig } from "vitest/config";

// Projects that open PGlite databases (packages/db and apps/server) run without per-file
// isolation: starting PGlite costs seconds of CPU, and @jobfilly/db/testing reuses the instances
// of a worker across test files, emptying them between tests. Their tests share no module state
// beyond that, so keep it so: inject fakes through parameters instead of vi.mock.
const pglite = { isolate: false, hookTimeout: 30_000, testTimeout: 30_000 };

export default defineConfig({
  test: {
    passWithNoTests: true,
    maxWorkers: 4,
    projects: [
      "packages/*",
      "!packages/db",
      "apps/*",
      "!apps/server",
      { test: { name: "@jobfilly/db", root: "./packages/db", ...pglite } },
      { test: { name: "@jobfilly/server", root: "./apps/server", ...pglite } },
    ],
  },
});
