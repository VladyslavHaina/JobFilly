import type { CvChoiceStage } from "./stages";

// The cv-choice stage (F2.3): the CV the app would use for a role, with its reason, or an
// editor's override. Written by the cvs-senders slice; until then it fails and roles stay
// unevaluated.
export const cvChoiceStage: CvChoiceStage = async () => {
  throw new Error("the cv-choice stage is written by the cvs-senders slice");
};
