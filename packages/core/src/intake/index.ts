// The intake (F6): the aggregation of the scan's findings into proposed answers, the input of the
// one extra-questions call, and the entries Confirm saves. Pure: no mail, database or model here.

export { aggregateIntake } from "./aggregate";
export { buildIntakeExtraInput, extraEvidenceIds, foundExtraQuestions } from "./extras";
export { confirmedEntries, type PatchResult, patchEntries } from "./profile";
