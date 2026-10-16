import type { AssistantTaskInput, TaskId } from "@jobfilly/schema";
import { BLOCKS_NOTE, block, jsonLine, type Prompt, systemMessage } from "../framing";

// assistant.v1: one turn of the assistant (F8), keyed by the user's message and the turn.
//
// Pinned by the foundation (no slice changes it): the header, the key line "Turn: <n>" at
// column 0 (the fake AI's key), and the framing: the user's message only ever as "| " lines in
// the "message" block (the last block), and the profile, rules and earlier turns as "| " lines
// in theirs.
//
// The instruction text below belongs to the assistant slice, which tunes it and regenerates
// e2e/fixtures/wire/assistant.v1.*.json when it does.

const TASK_ID: TaskId = "assistant.v1";

const INSTRUCTION =
  "You help the user steer their job search automation. Reply in the user's language. When they ask to change preferences or rules, propose the changes; when the request is unclear, ask one clarifying question with choices. You can't send mail, invite people, change mailboxes or AI settings, or delete data: say so and where that is done.";

const NOTE = BLOCKS_NOTE;

export function assistantPrompt(input: AssistantTaskInput): Prompt {
  const user = [
    `task: ${TASK_ID}`,
    `Turn: ${input.turn}`,
    "",
    ...block(
      "profile",
      input.entries.map((e) => `${e.key} (${e.label}): ${jsonLine(e.value)}`),
    ),
    ...block(
      "rules",
      input.rules.map(
        (r) =>
          `${r.id} [${r.enabled ? "on" : "off"}] ${jsonLine({ description: r.description, when: r.when, then: r.then })}`,
      ),
    ),
    ...block(
      "earlier turns",
      input.history.map((h) => `${h.role}: ${jsonLine(h.text)}`),
    ),
    ...block("message", [input.text]),
    "",
    "",
  ].join("\n");
  return { system: systemMessage(TASK_ID, INSTRUCTION, NOTE), user };
}
