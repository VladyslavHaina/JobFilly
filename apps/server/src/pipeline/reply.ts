import type { ReplyStage } from "./stages";

// The reply stage (F6, F7): a draft for each role replyEligibility lets through, or decisions for
// what a reply needs. Written by the replies slice; until then it does nothing.
export const replyStage: ReplyStage = async () => {};
