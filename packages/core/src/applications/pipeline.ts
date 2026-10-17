import {
  type Address,
  APPLICATION_STAGES,
  type ApplicationStage,
  type Category,
  type JobFacts,
  NO_REPLY_FLAG_DAYS,
  type Pipeline,
  type PipelineItem,
  type RoleRef,
} from "@jobfilly/schema";

// The application pipeline (MVP 3, F5), derived on read (D15) from what is stored: the roles, the
// mail of their threads, the replies sent from the app, and the stages an editor set by hand.
//
//   Threads   messages joined by In-Reply-To and References (a parent that isn't stored still
//             joins its replies).
//   Stage     every mail of the item's threads, oldest first: an interview, assessment, offer or
//             rejection always sets its stage; one of the user's own replies (or a reply sent from
//             the app) and an application update only move it forward, to replied or applied.
//             Other job mail sets nothing. A stage set by hand wins over all of it (F5.1).
//   Since     the mail that set the stage, or the change by hand; the role's own mail for new.
//   No reply  the item is open (replied to interview), the last thing in it is the user's own
//             (a reply, an application update confirming theirs, a stage set by hand to replied
//             or applied), and nothing has come back for NO_REPLY_FLAG_DAYS days (F5.2).
//   Same role roles with the same title and company (or the agency's client) are one item with
//             every sender (F5.3); a role without them stays alone, unless an earlier message of
//             its thread has a role: then it is that role's.

const DAY_MS = 24 * 60 * 60 * 1000;

/** One role, with its message's sender and date. */
export interface PipelineRoleInput extends RoleRef {
  facts: JobFacts;
  from: Address;
  receivedAt: Date;
}

/** One stored message the stage is read from: job mail, or one of the user's own. */
export interface PipelineMailInput {
  messageId: string;
  inReplyTo: string | null;
  references: readonly string[];
  receivedAt: Date;
  category: Category | null;
  /** The user wrote it (their own reply, or their own address). */
  own: boolean;
}

/** A reply to a role sent from the app (F4). */
export interface PipelineSentInput extends RoleRef {
  sentAt: Date;
}

/** A stage an editor set by hand. */
export interface ManualStageInput extends RoleRef {
  stage: ApplicationStage;
  setAt: Date;
}

export interface PipelineInput {
  roles: readonly PipelineRoleInput[];
  mail: readonly PipelineMailInput[];
  sent: readonly PipelineSentInput[];
  manual: readonly ManualStageInput[];
}

/** The stage each category of mail sets; the categories not listed set none. */
const CATEGORY_STAGE: Partial<Record<Category, ApplicationStage>> = {
  application_update: "applied",
  interview: "interview",
  assessment: "assessment",
  offer: "offer",
  rejection: "rejected",
};

/** Stages that only move a role forward, never back (the user's reply, an application update). */
const FORWARD_ONLY = new Set<ApplicationStage>(["replied", "applied"]);

/** Stages where the user waits on the other side, so a silence is flagged. */
const OPEN = new Set<ApplicationStage>(["replied", "applied", "interview", "assessment"]);

const ORDER = new Map(APPLICATION_STAGES.map((s, i) => [s, i]));
const rank = (stage: ApplicationStage) => ORDER.get(stage) ?? 0;

interface StageEvent {
  at: Date;
  stage: ApplicationStage | null;
  /** The user's own move: the next one is theirs to make. */
  ours: boolean;
}

/** The thread of every message: its root's id in a union-find over Message-IDs. */
function threads(mail: readonly PipelineMailInput[]): (messageId: string) => string {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root) ?? root;
    // Path compression keeps every lookup short.
    let at = id;
    while (at !== root) {
      const next = parent.get(at) ?? root;
      parent.set(at, root);
      at = next;
    }
    return root;
  };
  const join = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const m of mail) {
    for (const ref of [...m.references, ...(m.inReplyTo ? [m.inReplyTo] : [])]) {
      join(ref, m.messageId);
    }
  }
  return find;
}

/** Lower case, letters and digits only, single spaces: "Senior  Engineer (Remote)" matches "senior engineer remote". */
function normal(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** What makes two roles the same one (F5.3), or null when the role doesn't say. */
function sameRoleKey(facts: JobFacts): string | null {
  const title = normal(facts.title);
  const company = normal(facts.company ?? facts.agency?.client);
  return title && company ? `${title}\n${company}` : null;
}

const refKey = (r: RoleRef) => `${r.messageId}#${r.position}`;

function nextStep(stage: ApplicationStage, noReplyDays: number | null): string {
  if (noReplyDays !== null) return `Follow up: no answer for ${noReplyDays} days`;
  switch (stage) {
    case "new":
      return "Decide whether to reply";
    case "replied":
    case "applied":
      return "Wait for their answer";
    case "interview":
      return "Prepare for the interview";
    case "assessment":
      return "Do the assessment";
    case "offer":
      return "Decide on the offer";
    case "rejected":
    case "closed":
      return "Nothing more to do";
  }
}

/** Every role's pipeline item, grouped by stage in APPLICATION_STAGES order (GET /pipeline). */
export function buildPipeline(input: PipelineInput, now: Date): Pipeline {
  const threadOf = threads(input.mail);
  const roles = [...input.roles].sort(
    (a, b) =>
      a.receivedAt.getTime() - b.receivedAt.getTime() ||
      a.messageId.localeCompare(b.messageId) ||
      a.position - b.position,
  );

  // Group the roles: by what makes them the same role, else by an earlier role of their thread.
  const groups = new Map<string, PipelineRoleInput[]>();
  const firstInThread = new Map<string, { messageId: string; group: string }>();
  for (const role of roles) {
    const thread = threadOf(role.messageId);
    const earlier = firstInThread.get(thread);
    const key =
      sameRoleKey(role.facts) ??
      (earlier && earlier.messageId !== role.messageId ? earlier.group : `role:${refKey(role)}`);
    groups.set(key, [...(groups.get(key) ?? []), role]);
    if (!earlier) firstInThread.set(thread, { messageId: role.messageId, group: key });
  }

  const mailByThread = new Map<string, PipelineMailInput[]>();
  for (const m of input.mail) {
    const thread = threadOf(m.messageId);
    mailByThread.set(thread, [...(mailByThread.get(thread) ?? []), m]);
  }
  const manualOf = new Map(input.manual.map((m) => [refKey(m), m]));
  const sentOf = new Map<string, PipelineSentInput[]>();
  for (const s of input.sent) sentOf.set(refKey(s), [...(sentOf.get(refKey(s)) ?? []), s]);

  const byStage = new Map<ApplicationStage, PipelineItem[]>(APPLICATION_STAGES.map((s) => [s, []]));
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const events: StageEvent[] = [];
    for (const thread of new Set(group.map((r) => threadOf(r.messageId)))) {
      for (const m of mailByThread.get(thread) ?? []) {
        const stage = m.own ? "replied" : m.category ? (CATEGORY_STAGE[m.category] ?? null) : null;
        events.push({ at: m.receivedAt, stage, ours: m.own || stage === "applied" });
      }
    }
    for (const role of group) {
      for (const s of sentOf.get(refKey(role)) ?? []) {
        events.push({ at: s.sentAt, stage: "replied", ours: true });
      }
    }
    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    let stage: ApplicationStage = "new";
    let since = first.receivedAt;
    for (const e of events) {
      if (!e.stage || e.stage === stage) continue;
      if (FORWARD_ONLY.has(e.stage) && rank(e.stage) <= rank(stage)) continue;
      stage = e.stage;
      since = e.at;
    }

    // The latest change by hand on any of its roles wins (F5.1).
    const manual = group
      .map((r) => manualOf.get(refKey(r)))
      .filter((m) => m !== undefined)
      .sort((a, b) => b.setAt.getTime() - a.setAt.getTime())[0];
    if (manual) {
      stage = manual.stage;
      since = manual.setAt;
      events.push({ at: manual.setAt, stage: manual.stage, ours: FORWARD_ONLY.has(manual.stage) });
      events.sort((a, b) => a.at.getTime() - b.at.getTime());
    }

    const last = events.at(-1);
    const silentDays = last ? Math.floor((now.getTime() - last.at.getTime()) / DAY_MS) : 0;
    const noReply = OPEN.has(stage) && !!last?.ours && silentDays >= NO_REPLY_FLAG_DAYS;

    const senders = new Map<string, Address>();
    for (const r of group) senders.set(r.from.address.toLowerCase(), r.from);

    byStage.get(stage)?.push({
      role: { messageId: first.messageId, position: first.position },
      roles: group.map((r) => ({ messageId: r.messageId, position: r.position })),
      title: group.find((r) => r.facts.title)?.facts.title ?? null,
      company: group.map((r) => r.facts.company ?? r.facts.agency?.client).find((c) => c) ?? null,
      senders: [...senders.values()],
      stage,
      stageSource: manual ? "you" : "derived",
      since: since.toISOString(),
      nextStep: nextStep(stage, noReply ? silentDays : null),
      noReply,
    });
  }

  return {
    stages: APPLICATION_STAGES.map((stage) => ({
      stage,
      // The latest move first.
      items: (byStage.get(stage) ?? []).sort((a, b) => b.since.localeCompare(a.since)),
    })),
  };
}
