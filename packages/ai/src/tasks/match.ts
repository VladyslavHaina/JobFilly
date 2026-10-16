import type { MatchTaskInput, TaskId } from "@jobfilly/schema";
import {
  BLOCKS_NOTE,
  block,
  jsonLine,
  messageIdLines,
  type Prompt,
  systemMessage,
} from "../framing";

// match.v1: the fuzzy parts of the match (F4) for one role, keyed by its Message-ID and position.
//
// Pinned by the foundation (no slice changes it): the header, the key lines "Message-ID: <id>"
// and "Role: <position>" at column 0 (the fake AI's key), and the framing: the role (from the
// mail), the profile's words and the CV skills only ever as "| " lines inside their blocks.
//
// The instruction text below belongs to the rules-match slice, which tunes it and regenerates
// e2e/fixtures/wire/match.v1.*.json when it does.

const TASK_ID: TaskId = "match.v1";

const INSTRUCTION =
  "Judge only two things for this role. titleFit: fits when the title is one of the target roles or the same kind of role (seniority words aside), conflicts when it is clearly another kind of role, unknown when there is no title or no target roles. skillCloseness: one item for each of the role's skills, in their order: fits only when the CV skills or the profile skills hold that skill, under its own or another name for the same skill; unknown when neither holds it, even when a similar skill is there (name it in the reason). Never count a missing skill as a fit. Give every verdict a short reason.";

export function matchPrompt(input: MatchTaskInput): Prompt {
  const user = [
    `task: ${TASK_ID}`,
    ...messageIdLines(input.messageId),
    `Role: ${input.position}`,
    "",
    ...block("role", [
      `title: ${jsonLine(input.role.title)}`,
      `skills: ${jsonLine(input.role.skills)}`,
    ]),
    ...block("profile", [
      `target roles: ${jsonLine(input.profile.targetRoles)}`,
      `skills: ${jsonLine(input.profile.skills)}`,
    ]),
    ...block("cv skills", [jsonLine(input.cvSkills)]),
    "",
    "",
  ].join("\n");
  return { system: systemMessage(TASK_ID, INSTRUCTION, BLOCKS_NOTE), user };
}
