// The F5.3 proof (specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts) reads the state the MVP 1
// scenario specs leave behind, so it always runs after them, with no skip. e2e/stack.test.ts
// pins, in pnpm check, that every MVP 1 scenario has its spec, that the specs below are named as
// listed and that the proof sorts after all of them.

/** The proof's own file name; it sorts after every scenario spec in specs/mvp-1. */
export const F53_PROOF_SPEC = "99-f5.3-stored-equals-expected.spec.ts";

/**
 * The MVP 1 scenario specs whose state the proof reads: S1 registers Maria, S3 is her first
 * scan, S5 and S6 correct categories, S6 registers Tom, S7 is his scan, S8 and S9 analyse the
 * rest of Maria's job mail.
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
