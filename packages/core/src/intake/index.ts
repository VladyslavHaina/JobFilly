import type { IntakeInput, IntakeProposal } from "@jobfilly/schema";

// The intake aggregation (F6): answers from the user's replies' preferences and from the job
// mail's facts, each with its confidence and evidence; nothing without evidence. The
// intake-profile slice implements this module; the name and types are the contract.

export function aggregateIntake(_input: IntakeInput): IntakeProposal {
  throw new Error("aggregateIntake is not built yet (intake-profile slice)");
}
