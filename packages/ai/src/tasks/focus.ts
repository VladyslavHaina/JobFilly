import type { FocusTaskInput, TaskId } from "@jobfilly/schema";
import { BLOCKS_NOTE, block, type Prompt, systemMessage } from "../framing";

// focus.v1: a re-run of setup's hint (MVP 3, F1.1) read into what the scan focuses on
// (ScanFocusSchema), keyed by the hint.
//
// Pinned by the foundation (no slice changes it): the header and the framing: the hint only ever
// as "| " lines in the "message" block, the last block. There are no key lines; the fake AI keys
// the answer by the message.
//
// The instruction text below belongs to the profiles slice, which tunes it and regenerates
// e2e/fixtures/wire/focus.v1.*.json when it does.

const TASK_ID: TaskId = "focus.v1";

const INSTRUCTION = [
  "The user is setting up their job search again and says what changed. Read what the new search should focus on.",
  "List the countries they name as ISO 3166-1 alpha-2 codes and the cities as they write them, their working languages as ISO 639-1 codes, the work modes they want (remote, hybrid or onsite), the contract words as they write them, and any other words a job email for this search would contain.",
  "Leave a list empty when the user names nothing for it; never guess.",
].join(" ");

export function focusPrompt(input: FocusTaskInput): Prompt {
  const user = [`task: ${TASK_ID}`, "", ...block("message", [input.hint]), "", ""].join("\n");
  return { system: systemMessage(TASK_ID, INSTRUCTION, BLOCKS_NOTE), user };
}
