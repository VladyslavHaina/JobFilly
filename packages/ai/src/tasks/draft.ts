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

// The reply is checked after it comes back: questions go to the decision inbox, keyed by their
// profileKey and groupKey (apps/server, packages/core needsFromQuestions), and a placeholder gets
// one more attempt. So the instruction asks for exactly those fields' shapes. The app reads no
// yes or no from an answer's words, in any language: the model says of each answer it offers
// whether it declines, and an answer that declines writes nothing to the profile.
const INSTRUCTION = [
  "Write a short reply to this recruiter email for the role given, as the person whose profile and CV follow, in the language of the email; set language to its ISO 639-1 code.",
  "Use only the profile and the CV: state nothing about the person, their skills or their wishes that they don't back up.",
  "When the reply needs something they don't answer, don't guess: add a question instead, with profileKey the profile key the answer belongs to (a key from the profile, or extra.<short_slug> for anything else), groupKey that key followed by the parts that make it specific, separated by colons (for example min_pay:<ISO 4217 currency code>:<pay period>), and a few short answers to choose from in the language of the email.",
  "For each answer set declines to true when choosing it turns the question down or accepts anything other than exactly what the groupKey describes (a no, another place, currency, pay period or scope, a condition), and to false only when it accepts exactly that; an answer about an amount states it in digits with the currency's code.",
  "Address the sender by the name they sign with; never write a template placeholder such as [Name] or {company}.",
  "Set attachCv when the email asks for a CV.",
].join(" ");

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
  return { system: systemMessage(TASK_ID, INSTRUCTION, BLOCKS_NOTE), user };
}
