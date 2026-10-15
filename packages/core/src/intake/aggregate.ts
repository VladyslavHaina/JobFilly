import {
  CORE_PROFILE_KEYS,
  CORE_PROFILE_LABELS,
  type Confidence,
  type CoreProfileKey,
  type IntakeInput,
  type IntakeProposal,
  type IntakeProposalEntry,
  type JobFacts,
  NOT_ENOUGH_EVIDENCE,
  type ProfileValues,
} from "@jobfilly/schema";

// The intake aggregation (F6): each core answer comes with its confidence and its evidence, and
// nothing is proposed without evidence. The rules, word for word the same as the e2e fixtures'
// generator uses for expected.json:
//
//   1. Inputs are the replies' preferences and the analysed job messages' roles (not_job and
//      failed messages are left out; failed ones never reach the input).
//   2. A key stated in at least one reply takes its values only from replies: the union of the
//      stated values, deduplicated by a normalised form (case-folded and trimmed; places by
//      country+city+mode, min_pay by amount+currency+period, work_permits by country+text),
//      worded as in the newest reply stating it; evidence = the stating replies, newest first.
//   3. Any other key takes a value from job facts only when that value appears in at least 5
//      distinct job messages; evidence = those messages, newest first. min_pay, reply_to and
//      deal_breakers come from replies only.
//   4. No evidence: an empty answer, confidence null, "Not enough evidence".
//
// Values are kept as worded: no contract, seniority or permit vocabulary is built in here.
// Confidence and the reason depend only on the answer's own evidence, so job mail never changes
// an answer the user's replies state.

type Key = CoreProfileKey;
type Item = ProfileValues[Key][number];

/** A job value must appear in this many distinct job messages to be proposed (rule 3). */
const MIN_JOB_MESSAGES = 5;

/** The keys only the user's own replies can answer (rule 3). */
const REPLY_ONLY_KEYS: ReadonlySet<Key> = new Set<Key>(["min_pay", "reply_to", "deal_breakers"]);

const fold = (text: string | null | undefined) => (text ?? "").trim().toLowerCase();

/** The form two values of `key` are compared in (rule 2). */
function normalForm(key: Key, value: Item): string {
  if (typeof value === "string") return fold(value);
  switch (key) {
    case "places": {
      const p = value as ProfileValues["places"][number];
      return [p.country.toUpperCase(), fold(p.city), p.mode].join("|");
    }
    case "remote": {
      const r = value as ProfileValues["remote"][number];
      return [fold(r.scope), r.timeZones?.from ?? "", r.timeZones?.to ?? ""].join("|");
    }
    case "min_pay": {
      const m = value as ProfileValues["min_pay"][number];
      return [m.amount, m.currency.toUpperCase(), m.period].join("|");
    }
    case "work_permits": {
      const w = value as ProfileValues["work_permits"][number];
      return [w.country?.toUpperCase() ?? "", fold(w.text)].join("|");
    }
    default:
      return JSON.stringify(value);
  }
}

/** A value that says something: blank words are no evidence. */
const meaningful = (value: Item) => typeof value !== "string" || value.trim() !== "";

const nonBlank = (text: string | null): text is string => text !== null && text.trim() !== "";

/** The values one role offers for `key` (rule 3); reply-only keys get none. */
function jobValues(key: Key, role: JobFacts): Item[] {
  switch (key) {
    case "target_roles":
      return nonBlank(role.title) ? [role.title] : [];
    case "seniority":
      return nonBlank(role.seniority) ? [role.seniority] : [];
    case "places": {
      const mode = role.workMode;
      if (mode !== "onsite" && mode !== "hybrid") return [];
      return role.places.flatMap((p) =>
        p.country === null ? [] : [{ country: p.country, city: p.city, mode }],
      );
    }
    case "remote":
      return role.remoteScope !== null || role.timeZones !== null
        ? [{ scope: role.remoteScope ?? "", timeZones: role.timeZones }]
        : [];
    case "contracts":
      return nonBlank(role.contract) ? [role.contract] : [];
    case "languages":
      return role.languages.filter((l) => l.trim() !== "");
    case "work_permits":
      return nonBlank(role.workPermit) ? [{ country: null, text: role.workPermit }] : [];
    default:
      return [];
  }
}

/** Newest first; a stable sort, so equal dates keep the order they came in. */
function newestFirst<T extends { date: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/**
 * How sure an answer the user's replies state is: one reply is a hint, two agree, three or more
 * settle it.
 */
function replyConfidence(replies: number): Exclude<Confidence, null> {
  if (replies >= 3) return "high";
  if (replies >= 2) return "medium";
  return "low";
}

/**
 * How sure an answer taken from job mail is. Job mail shows what is offered, not what the user
 * wants, so it never gets past medium: 10 or more messages make it medium, fewer low.
 */
function jobConfidence(messages: number): Exclude<Confidence, null> {
  return messages >= 10 ? "medium" : "low";
}

const replyReason = (n: number) =>
  n === 1 ? "from one of your replies" : `from ${n} of your replies`;
const jobReason = (n: number) => `in ${n} job emails`;

interface Answer {
  values: Item[];
  evidence: string[];
  confidence: Confidence;
  reason: string;
}

function fromReplies(key: Key, replies: IntakeInput["replies"]): Answer | null {
  const stating: { messageId: string; values: Item[] }[] = [];
  for (const reply of replies) {
    const values = ((reply.preferences[key] ?? []) as Item[]).filter(meaningful);
    if (values.length > 0) stating.push({ messageId: reply.messageId, values });
  }
  if (stating.length === 0) return null;
  const seen = new Set<string>();
  const values: Item[] = [];
  for (const reply of stating) {
    for (const value of reply.values) {
      const form = normalForm(key, value);
      if (seen.has(form)) continue;
      seen.add(form);
      values.push(value);
    }
  }
  return {
    values,
    evidence: stating.map((r) => r.messageId),
    confidence: replyConfidence(stating.length),
    reason: replyReason(stating.length),
  };
}

function fromJobs(key: Key, jobs: IntakeInput["jobs"]): Answer | null {
  if (REPLY_ONLY_KEYS.has(key)) return null;
  const offered = jobs.map((job) => ({
    messageId: job.messageId,
    values: job.roles.flatMap((role) => jobValues(key, role)),
  }));
  const messagesOf = new Map<string, Set<string>>();
  for (const job of offered) {
    for (const value of job.values) {
      const form = normalForm(key, value);
      const ids = messagesOf.get(form) ?? new Set<string>();
      ids.add(job.messageId);
      messagesOf.set(form, ids);
    }
  }
  const seen = new Set<string>();
  const values: Item[] = [];
  const evidence = new Set<string>();
  for (const job of offered) {
    for (const value of job.values) {
      const form = normalForm(key, value);
      if ((messagesOf.get(form)?.size ?? 0) < MIN_JOB_MESSAGES) continue;
      evidence.add(job.messageId);
      if (seen.has(form)) continue;
      seen.add(form);
      values.push(value);
    }
  }
  if (values.length === 0) return null;
  return {
    values,
    evidence: [...evidence],
    confidence: jobConfidence(evidence.size),
    reason: jobReason(evidence.size),
  };
}

function entry(key: Key, answer: Answer | null): IntakeProposalEntry {
  const base = { key, label: CORE_PROFILE_LABELS[key] };
  if (!answer) {
    return { ...base, value: [], confidence: null, evidence: [], emptyReason: NOT_ENOUGH_EVIDENCE };
  }
  return {
    ...base,
    value: answer.values as IntakeProposalEntry["value"],
    confidence: answer.confidence,
    evidence: answer.evidence.map((messageId) => ({ messageId, reason: answer.reason })),
    emptyReason: null,
  };
}

/** The intake form's proposal: every core question in form order, answered or empty (F6). */
export function aggregateIntake(input: IntakeInput): IntakeProposal {
  const replies = newestFirst(input.replies);
  const jobs = newestFirst(input.jobs.filter((job) => job.category !== "not_job"));
  return {
    entries: CORE_PROFILE_KEYS.map((key) =>
      entry(key, fromReplies(key, replies) ?? fromJobs(key, jobs)),
    ),
  };
}
