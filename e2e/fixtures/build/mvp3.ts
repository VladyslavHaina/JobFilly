import type { AnswerAnswerFile, FocusAnswerFile } from "../format.ts";

// MVP 3's fake-AI answers for the new prompts, generated into ai/focus.json and ai/answer.json.
// Owned by the fixtures slice (its plan), which fills them with the answers for S1's hint and
// the assistant questions of S9 (e2e/fixtures/assistant/questions.json).

/** focus.v1's answers, by assistantMessageKey(hint). */
export function focusAnswers(): FocusAnswerFile {
  return {};
}

/** answer.v1's answers, by assistantMessageKey(question), then turn. */
export function answerAnswers(): AnswerAnswerFile {
  return {};
}
