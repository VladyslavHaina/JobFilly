import {
  APPLICATION_STAGES,
  ASSISTANT_TOOLS,
  type AssistantTaskInput,
  AssistantTaskInputSchema,
  type AssistantTool,
  CATEGORIES,
  CORE_PROFILE_KEYS,
  type CoreProfileKey,
  entryLabel,
  MAX_LOOKUP_ROUNDS,
  PayPeriodSchema,
  POLICY_KEYS,
  type PolicyKey,
  RULE_ACTIONS,
  RULE_FACTS,
  RULE_OPS,
  type RuleOp,
  type TaskId,
} from "@jobfilly/schema";
import { BLOCKS_NOTE, block, jsonLine, type Prompt, systemMessage } from "../framing";
import { lookupBlocks } from "./answer";

// assistant.v1: one turn of the assistant (F8), keyed by the user's message and the turn.
//
// Pinned by the foundation (no slice changes it): the header, the key line "Turn: <n>" at
// column 0 (the fake AI's key), and the framing: the user's message only ever as "| " lines in
// the "message" block (the last block), and the profile, rules and earlier turns as "| " lines
// in theirs.
//
// MVP 3 (F8): a question's lookups run in rounds. From round 2 on, the key line "Round: <n>"
// follows the turn's, and the results so far come before the message, one "lookup <n>" block
// each, as answer.v1 reads them; the first round's prompt has neither.
//
// The instruction text below belongs to the assistant slice, which tunes it and regenerates
// e2e/fixtures/wire/assistant.v1.*.json when it does.

const TASK_ID: TaskId = "assistant.v1";

/** "a, b or c". */
const either = (words: readonly string[]) =>
  words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;

/** What each condition op compares with; a new op in packages/schema fails typecheck here. */
const OP_VALUES: Record<RuleOp, string> = {
  in: "a list of words",
  not_in: "a list of words",
  within: 'a range of UTC offsets { from, to } such as "UTC+05:00"',
  outside: 'a range of UTC offsets { from, to } such as "UTC+05:00"',
  below: "{ amount, currency, period }",
  contains: "a list of words",
  equals: "a list of words",
  missing: "null",
};

/**
 * Which facts hold free text as the mail words it (JobFacts keeps contract, company and agency
 * names and extra facts as written) and which a fixed set of values; a new fact in
 * packages/schema fails typecheck here. The engine compares `in`, `not_in` and `equals` with the
 * whole value, and `contains` in whole words, so a rule on free text needs `contains`.
 */
const FREE_TEXT: Record<(typeof RULE_FACTS)[number], boolean> = {
  "places.country": false,
  workMode: false,
  timeZones: false,
  pay: false,
  contract: true,
  company: true,
  agency: true,
  "sender.domain": false,
  category: false,
  skills: false,
  languages: false,
};

/** How `in` and `contains` differ, and which facts need which. */
function opSemantics(): string {
  const free = [...RULE_FACTS.filter((f) => FREE_TEXT[f]), "extra.<key>"];
  const fixed = RULE_FACTS.filter((f) => !FREE_TEXT[f] && f !== "timeZones" && f !== "pay");
  return [
    `\`in\`, \`not_in\` and \`equals\` hold only when the fact's whole value, or a whole item of a list, is one of the words: use them for facts with a fixed set of values, ${either(fixed)}, with codes and values as the profile and this instruction write them.`,
    `${either(free)} are free text as the mail words it, so \`in\` almost never holds for them: use \`contains\`, which holds when the text has any of the words as whole words, and give short phrases as a mail would write them (not inflected as in the user's message), in each of the languages of the user's job mail named below, and in the language of the user's message.`,
  ].join(" ");
}

/** The ops in schema order, neighbours with the same value together: "in or not_in (value: …)". */
function opWords(): string {
  const groups: { ops: RuleOp[]; value: string }[] = [];
  for (const op of RULE_OPS) {
    const last = groups.at(-1);
    if (last?.value === OP_VALUES[op]) last.ops.push(op);
    else groups.push({ ops: [op], value: OP_VALUES[op] });
  }
  const parts = groups.map((g) => `${either(g.ops)} (value: ${g.value})`);
  return `${parts.slice(0, -1).join(", ")}, or ${parts.at(-1)}`;
}

const WORDS = "a list of words";
const COUNTRY = "an ISO 3166-1 alpha-2 code";

/** What each profile key's value is, as JSON; a new key in packages/schema fails typecheck here. */
const KEY_VALUES: Record<CoreProfileKey | PolicyKey, string> = {
  target_roles: WORDS,
  seniority: WORDS,
  places: `[{ country, city, mode }] with country ${COUNTRY}, city a name or null, mode onsite or hybrid`,
  remote: "[{ scope, timeZones }] with scope in words, timeZones { from, to } or null",
  contracts: WORDS,
  min_pay: `[{ amount, currency, period, asWritten }] with currency an ISO 4217 code, period ${either(PayPeriodSchema.options)}, asWritten as the user wrote it`,
  languages: WORDS,
  work_permits: `[{ country, text }] with country ${COUNTRY} or null`,
  reply_to: `a list of categories: ${either(CATEGORIES)}`,
  deal_breakers: WORDS,
  reply_threshold: "one whole number in a list, [n]",
  reply_window_days: "one whole number in a list, [n]",
};

/** "places (Places you'd work onsite or hybrid): […]; …", every key the profile can hold. */
function keyWords(): string {
  const keys = [...CORE_PROFILE_KEYS, ...POLICY_KEYS].map(
    (key) => `${key} (${entryLabel(key)}): ${KEY_VALUES[key]}`,
  );
  return [...keys, `extra.<key>: ${WORDS}`].join("; ");
}

/** What each lookup reads and the fields it uses; a new tool in packages/schema fails here. */
const TOOL_WORDS: Record<AssistantTool, string> = {
  waiting: "what waits on the user: open decisions and drafts not reviewed yet",
  find_roles:
    "roles found by `words` (a few words of the title, company, agency, places or sender as the mail writes them, all of which must appear; null for every role), each in full with its Message-ID",
  role: "one role in full by `messageId`, its Message-ID as a lookup result or an earlier answer's refs name it (a whole ref \"<Message-ID>#<position>\" is taken too, its position the role's), and optionally `position` (null for 0, the first role of the message): its facts, profile and why it is assigned to it, fit score with every reason, rules, stage, decisions and why it has a draft or none",
  pipeline: `the application pipeline: counts by stage and the roles in it with their Message-IDs, only those in \`stage\` (${either(APPLICATION_STAGES)}) when set, and only those that got there in the last \`days\` days when set`,
  message_text:
    "one message's text by `messageId`, its Message-ID as a lookup result or an earlier answer's refs name it",
  profile: "the user's profiles with their entries and rules",
};

/** When to ask for lookups (MVP 3, F8.2), and what each reads. */
function lookupWords(): string {
  const tools = ASSISTANT_TOOLS.map((t) => `\`${t}\`: ${TOOL_WORDS[t]}`).join("; ");
  return [
    "When the user asks a question about their job search (what waits on them, their roles, why a role has no draft, their pipeline, a message, their profile), set `lookups` to the read-only lookups whose results answer it, and `clarify` and `proposal` to null: the answer is written from their results, so never answer such a question from memory, and keep `reply` short.",
    `A lookup sets \`tool\` and the fields that tool uses; every other field is null. The tools: ${tools}.`,
    "Ask for the fewest lookups that answer it, at most five. For any other message set `lookups` to [].",
    "`role` and `message_text` take an exact Message-ID: never guess one. When you don't have it yet, ask only for the search that finds the role or message (`find_roles`, `waiting` or `pipeline`): you are then asked again with its results, and can ask for `role` or `message_text` with the Message-IDs they give. When a result says a Message-ID was not found, ask for the `find_roles` search that finds the role or message instead of guessing another one.",
    `From round 2 on, the results so far are given below: ask only for the lookups still needed to answer, never one already run, and set \`lookups\` to [] when the results answer the question. There are at most ${MAX_LOOKUP_ROUNDS} rounds.`,
  ].join(" ");
}

// The rule vocabulary (facts, ops, actions) comes from packages/schema, so the instruction never
// falls out of step with what the answer check accepts.
//
// It names every shape a Change can take, because the model can only propose changes to the
// listed rules and profile entries (F8.2); says to ask instead of guessing (F8.6); and lists what
// the assistant can't do, with where each is done (F8.7). Nothing in it is market-specific: every
// value a change carries comes from the user's words or the listed profile.
const INSTRUCTION = [
  "You help the user steer their job search automation, the rules and profile entries listed below, and answer their questions about their job search. Write `reply` in the language of the user's message.",
  lookupWords(),
  [
    "When the user asks to change their preferences or what the app does with matching mail, set `proposal` to a short `summary` in the user's language and the `changes` that do it, and `clarify` to null. A change adds, updates or removes a rule (by its id) or a profile entry (by its key). `add` on an entry appends the given items to its list; `update` replaces its value; `remove` with a value removes those items, and with null the whole entry.",
    "Each change sets `op`, `target` (rule or entry), `ruleId` for a rule it updates or removes, `key` for an entry, `rule` to the rule as JSON text for add and update, and `value` to the entry's value as JSON text; every field a change doesn't use is null.",
    "A rule is { description, when, then, enabled }: `description` says in plain words what it does; it holds when every condition in `when` holds;",
    `\`then\` is ${either(RULE_ACTIONS)}. A condition is { fact, op, value } with fact one of ${either([...RULE_FACTS, "extra.<key>"])}; op ${opWords()}.`,
    opSemantics(),
    `An entry's value, by key: ${keyWords()}.`,
    "Use only values the user stated or the profile holds; never invent one.",
  ].join(" "),
  "When the request is unclear, set `clarify` to one question with two to four short answers to pick in `choices`, and `proposal` to null: never guess.",
  "It is unclear only when you can't tell what the user wants changed. When that is clear but a value could be read more widely or narrowly, such as the UTC offsets a region spans, propose the likeliest reading: the user can edit a proposal before applying it.",
  "A proposal changes nothing until the user applies it themselves, so never say a change is made.",
  "The profile and rules below are those of the profile a change would go to. When the user's message only names one of their profiles, it answers which profile an earlier request is for: propose that request's changes.",
  "You can't send mail, invite people, change mailboxes or AI settings, or delete data. When asked to, set `clarify` and `proposal` to null and say you can't and where it is done: replies wait as drafts on the Drafts page and in the mailbox's Drafts folder, and the user sends each one there or from their own mail app; people are invited on the Members page; the mailbox and the AI settings are under Settings; CVs are deleted on the CVs page.",
].join("\n");

/** An ISO 639-1 code, so the system message never carries anything else. */
const LANGUAGE_CODE = AssistantTaskInputSchema.shape.mailLanguages.element;

/**
 * The line after the instruction naming the job mail's languages (most frequent first), which
 * the `contains` guidance refers to: the model can't see the mail, only the user's message.
 */
function mailLanguagesLine(codes: readonly string[]): string {
  const valid = codes.filter((c) => LANGUAGE_CODE.safeParse(c).success);
  return `Languages of the user's job mail: ${valid.length > 0 ? valid.join(", ") : "not known yet"}.`;
}

export function assistantPrompt(input: AssistantTaskInput): Prompt {
  const later = (input.round ?? 1) > 1;
  const user = [
    `task: ${TASK_ID}`,
    `Turn: ${input.turn}`,
    ...(later ? [`Round: ${input.round}`] : []),
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
    ...(later ? lookupBlocks(input.results ?? []) : []),
    ...block("message", [input.text]),
    "",
    "",
  ].join("\n");
  const instruction = `${INSTRUCTION}\n${mailLanguagesLine(input.mailLanguages)}`;
  return { system: systemMessage(TASK_ID, instruction, BLOCKS_NOTE), user };
}
