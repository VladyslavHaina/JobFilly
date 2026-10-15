import { defineConfig, devices } from "@playwright/test";

// The specs run against the test stack that `pnpm e2e:stack up` started (e2e/stack.ts passes
// its project as JOBFILLY_E2E_PROJECT, for infrastructure steps). JOBFILLY_E2E_MVP=<n> runs
// specs/mvp-<n> only; otherwise every MVP's specs run.
//
// One run plays the scenarios in order on one stack, and later specs start from the state
// earlier ones leave behind: one worker, files in name order (specs/mvp-1 before specs/mvp-2).

const mvp = process.env.JOBFILLY_E2E_MVP;

/**
 * The codified MVP 1 scenario specs whose state the F5.3 proof (specs/mvp-1/99-…) reads: S1
 * registers Maria, S3 is her first scan, S5 and S6 correct categories, S6 registers Tom, S7 is
 * his scan, S8 and S9 analyse the rest of Maria's job mail. Their names sort before the proof's.
 */
export const F53_PROOF_NEEDS = [
  "01-s1-maria-registers.spec.ts",
  "03-s3-first-scan.spec.ts",
  "05-s5-job-inbox.spec.ts",
  "06-s6-inviting-tom.spec.ts",
  "07-s7-toms-thin-inbox.spec.ts",
  "08-s8-budget-stop.spec.ts",
  "09-s9-replica-dies.spec.ts",
] as const;

/**
 * Why the F5.3 proof skips given the entries of specs/mvp-1, or undefined when every spec it
 * needs is there and it must run (and pass). Before the codify step only the walkthrough plays
 * the scenarios, so a spec-only run has no personas to read.
 */
export function f53ProofSkipReason(entries: readonly string[]): string | undefined {
  const present = new Set(entries);
  return F53_PROOF_NEEDS.every((name) => present.has(name))
    ? undefined
    : "needs the codified S1–S9 specs; the walkthrough covers F5.3 until then";
}

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
