import {
  type AnswerAnswerFile,
  ASSISTANT_ANY_TURN,
  assistantMessageKey,
  type FocusAnswer,
  type FocusAnswerFile,
} from "../format.ts";
import { MARIA_RERUN_HINT } from "../format-mvp3.ts";
import { questionAnswers } from "./questions.ts";

// MVP 3's fake-AI answers for the new prompts, generated into ai/focus.json and ai/answer.json:
// focus.v1's for S1's hint and answer.v1's for the assistant's questions (questions.ts). The rest
// of MVP 3's files come from mvp3-files.ts.

/** What S1's hint asks the re-run to focus on: Germany, permanent contracts. */
export const RERUN_FOCUS: FocusAnswer = {
  countries: ["DE"],
  cities: [],
  languages: [],
  workModes: [],
  contracts: ["permanent"],
  words: ["Germany", "Deutschland", "unbefristet", "Festanstellung"],
};

/** focus.v1's answers, by assistantMessageKey(hint). */
export function focusAnswers(): FocusAnswerFile {
  return { [assistantMessageKey(MARIA_RERUN_HINT)]: RERUN_FOCUS };
}

/** answer.v1's answers, by assistantMessageKey(question), then turn (any). */
export function answerAnswers(): AnswerAnswerFile {
  const file: AnswerAnswerFile = {};
  for (const q of questionAnswers()) {
    const key = assistantMessageKey(q.text);
    if (file[key]) throw new Error(`two answer.v1 answers for "${q.text}"`);
    file[key] = { [ASSISTANT_ANY_TURN]: q.answer };
  }
  return file;
}
