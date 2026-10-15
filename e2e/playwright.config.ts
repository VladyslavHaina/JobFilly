import { defineConfig, devices } from "@playwright/test";

// The specs run against the test stack that `pnpm e2e:stack up` started (e2e/stack.ts passes
// its project as JOBFILLY_E2E_PROJECT, for infrastructure steps). JOBFILLY_E2E_MVP=<n> runs
// specs/mvp-<n> only; otherwise every MVP's specs run.
//
// One run plays the scenarios in order on one stack, and later specs start from the state
// earlier ones leave behind: one worker, files in name order (specs/mvp-1 before specs/mvp-2).

const mvp = process.env.JOBFILLY_E2E_MVP;

export default defineConfig({
  testDir: mvp ? `specs/mvp-${mvp}` : "specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  // Under e2e/reports, which is git-ignored.
  outputDir: "reports/playwright",
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
