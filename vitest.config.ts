import { defineConfig } from "vitest/config";

// Projects that open PGlite databases (packages/db and apps/server) run without per-file
// isolation: starting PGlite costs seconds of CPU, and @jobfilly/db/testing reuses the instances
// of a worker across test files, emptying them between tests. Their tests share no module state
// beyond that, so keep it so: inject fakes through parameters instead of vi.mock.
//
// The timeouts allow for a machine shared with other builds: under a load several times its
// core count, a worker's first PGlite start took over 30 seconds and jsdom renders of the web
// app over Vitest's default 5 seconds, failing tests that pass on a quiet machine. A test that
// really hangs still fails, only later.
const pglite = { isolate: false, hookTimeout: 120_000, testTimeout: 120_000 };

export default defineConfig({
  test: {
    passWithNoTests: true,
    maxWorkers: 4,
    projects: [
      "packages/*",
      "!packages/db",
      "apps/*",
      "!apps/server",
      "!apps/web",
      { test: { name: "@jobfilly/db", root: "./packages/db", ...pglite } },
      { test: { name: "@jobfilly/server", root: "./apps/server", ...pglite } },
      {
        // apps/web's own config (React, jsdom), with room for a loaded machine.
        extends: "./apps/web/vitest.config.ts",
        test: { name: "@jobfilly/web", root: "./apps/web", testTimeout: 30_000 },
      },
      {
        test: {
          name: "@jobfilly/e2e",
          root: "./e2e",
          // The Playwright specs run against the test stack (pnpm e2e), never under Vitest.
          exclude: ["specs/**", ".stack/**", "reports/**", "**/node_modules/**"],
        },
      },
    ],
  },
});
