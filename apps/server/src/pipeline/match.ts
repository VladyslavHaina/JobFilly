import type { MatchStage } from "./stages";

// The match stage (F3, F4): the rules engine and the explainable match, with stored match.v1
// answers. Written by the rules-match slice; until then it fails and roles stay unevaluated.
export const matchStage: MatchStage = async () => {
  throw new Error("the match stage is written by the rules-match slice");
};
