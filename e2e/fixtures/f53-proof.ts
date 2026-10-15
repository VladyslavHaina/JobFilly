// The guard of the F5.3 proof (specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts). The proof
// reads the state the codified MVP 1 scenario specs leave behind. Before the codify step
// specs/mvp-1 holds only the stack check and the proof, nothing has registered, scanned or
// analysed what it reads, and the walkthrough covers F5.3: that is the one state in which the
// proof skips. Once any scenario spec is there it always runs, so a spec it needs that is missing
// or renamed fails it loudly instead of silencing it. e2e/stack.test.ts pins this.

/** The proof's own file name; it sorts after every scenario spec in specs/mvp-1. */
export const F53_PROOF_SPEC = "99-f5.3-stored-equals-expected.spec.ts";

/** The spec that checks the stack itself, the only other spec before codification. */
const STACK_SPEC = "00-stack.spec.ts";

/**
 * The codified MVP 1 scenario specs whose state the proof reads: S1 registers Maria, S3 is her
 * first scan, S5 and S6 correct categories, S6 registers Tom, S7 is his scan, S8 and S9 analyse
 * the rest of Maria's job mail. Their names sort before the proof's.
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

export const F53_PROOF_SKIP_REASON =
  "needs the codified S1–S9 specs; the walkthrough covers F5.3 until then";

/** The specs in the entries of specs/mvp-1 other than the stack check and the proof. */
function scenarioSpecs(entries: readonly string[]): string[] {
  return entries.filter(
    (name) => name.endsWith(".spec.ts") && name !== STACK_SPEC && name !== F53_PROOF_SPEC,
  );
}

/**
 * Why the proof skips given the entries of specs/mvp-1, or undefined when it must run (and pass).
 * It skips only before codification, while the directory holds no scenario spec at all.
 */
export function f53ProofSkipReason(entries: readonly string[]): string | undefined {
  return scenarioSpecs(entries).length === 0 ? F53_PROOF_SKIP_REASON : undefined;
}

/** The specs the proof needs that the entries of specs/mvp-1 lack, in F53_PROOF_NEEDS order. */
export function missingF53ProofNeeds(entries: readonly string[]): string[] {
  const present = new Set(entries);
  return F53_PROOF_NEEDS.filter((name) => !present.has(name));
}
