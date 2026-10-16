import type { DraftTaskInput, TaskId } from "@jobfilly/schema";
import {
  BLOCKS_NOTE,
  block,
  jsonLine,
  messageIdLines,
  type Prompt,
  systemMessage,
} from "../framing";

// draft.v1: one reply draft (F6) for one role, keyed by the message's Message-ID, the role's
// position (drafts are per role: two roles of one message get two answers) and the attempt (2
// when the first answer held a template placeholder, F6.2).
//
// Pinned by the foundation (no slice changes it): the header, the key lines "Message-ID: <id>",
// "Role: <position>" and "Attempt: <1|2>" at column 0 (the fake AI's key), and the framing: the
// mail, the role, the profile and the CV only ever as "| " lines inside their blocks.
//
// The instruction text below belongs to the replies slice, which tunes it and regenerates
// e2e/fixtures/wire/draft.v1.*.json when it does.

const TASK_ID: TaskId = "draft.v1";

const INSTRUCTION =
  "Write a short reply to this recruiter email, in the language of the email, for the role given. Use only the profile and the CV given; for anything they don't answer, add a question instead of guessing. Never write a template placeholder such as [Name] or {company}. Set attachCv when the email asks for a CV.";

const NOTE = BLOCKS_NOTE;

export function draftPrompt(input: DraftTaskInput): Prompt {
  const { mail } = input;
  const from = mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address;
  const user = [
    `task: ${TASK_ID}`,
    ...messageIdLines(mail.messageId),
    `Role: ${input.position}`,
    `Attempt: ${input.attempt}`,
    "",
    ...block("mail", [
      `From: ${from}`,
      `Date: ${mail.date}`,
      `Subject: ${mail.subject}`,
      "",
      mail.text,
    ]),
    ...block("role", [`position: ${input.position}`, jsonLine(input.role)]),
    ...block(
      "profile",
      input.entries.map((e) => `${e.key} (${e.label}): ${jsonLine(e.value)}`),
    ),
    ...block(
      "cv",
      input.cv
        ? [
            `name: ${input.cv.name}`,
            `language: ${input.cv.language ?? "unknown"}`,
            `skills: ${jsonLine(input.cv.skills)}`,
            "",
            input.cv.text,
          ]
        : ["(no CV)"],
    ),
    "",
    "",
  ].join("\n");
  return { system: systemMessage(TASK_ID, INSTRUCTION, NOTE), user };
}
