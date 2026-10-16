import {
  type Address,
  type Category,
  type CvChoice,
  JOB_CATEGORIES,
  type JobFacts,
  type MailFolder,
  type RoleEvaluation,
  type SenderCheck,
  type SenderVerdict,
} from "@jobfilly/schema";
import { and, asc, eq, inArray, isNotNull, ne, or, type SQL, sql } from "drizzle-orm";
import { type Database, queryRows } from "../client";
import { messages, profiles, roleEvaluations, roles, senderChecks } from "../tables";
import { type DraftHistory, draftHistory, listDraftsToRetry, roleKey } from "./draft-claims";
import { fromDomain } from "./sender-domain";
import { replyHeldSql, roleHeldSql, senderHeldSql } from "./stage-failures";

// The pipeline's view of the job mail (ARCHITECTURE › Background work, "The analysis pipeline").
// Each role of a job message has an evaluation (role_evaluations) and each job message a sender
// check (sender_checks). Either is "missing" until the pipeline has made it and "stale" once a
// change made it out of date; listToEvaluate lists both, so the first scan's backlog (F1.6), new
// mail, and every later change are evaluated by the same job (pipeline.reevaluate).
//
// Job messages are analysed messages with a job category, never the user's own replies.

export interface RoleRef {
  messageId: string;
  position: number;
}

/** What markStale makes out of date: everything, some roles or messages, or one sender's mail. */
export type StaleScope =
  | { all: true }
  | { roles: readonly RoleRef[] }
  | { messageIds: readonly string[] }
  | { senderAddress: string }
  | { senderDomain: string };

const isJobMessage = and(
  ne(messages.stageOne, "own_reply"),
  eq(messages.analysisStatus, "done"),
  inArray(messages.category, [...JOB_CATEGORIES]),
);

/** Stores a role's evaluation as current (stale cleared). */
export async function saveEvaluation(
  db: Database,
  workspaceId: string,
  messageId: string,
  evaluation: Omit<RoleEvaluation, "stale" | "evaluatedAt">,
  at: Date,
): Promise<void> {
  const set = {
    score: evaluation.match?.score ?? null,
    capped: evaluation.match?.capped ?? false,
    match: evaluation.match,
    hiddenRuleId: evaluation.hidden?.ruleId ?? null,
    hiddenReason: evaluation.hidden?.reason ?? null,
    ruleEffects: evaluation.ruleEffects,
    cvId: evaluation.cvChoice.cvId,
    cvReason: evaluation.cvChoice.reason,
    cvSource: evaluation.cvChoice.source,
    stale: false,
    staleSince: null,
    evaluatedAt: at,
  };
  await db
    .insert(roleEvaluations)
    .values({ workspaceId, messageId, position: evaluation.position, ...set })
    .onConflictDoUpdate({
      target: [roleEvaluations.workspaceId, roleEvaluations.messageId, roleEvaluations.position],
      set,
    });
}

/** Stores a message's sender check as current (stale cleared). */
export async function saveSenderCheck(
  db: Database,
  workspaceId: string,
  messageId: string,
  check: SenderCheck,
  at: Date,
): Promise<void> {
  const set = {
    verdict: check.verdict,
    complete: check.complete,
    reasons: check.reasons,
    mark: check.mark,
    stale: false,
    staleSince: null,
    checkedAt: at,
  };
  await db
    .insert(senderChecks)
    .values({ workspaceId, messageId, ...set })
    .onConflictDoUpdate({ target: [senderChecks.workspaceId, senderChecks.messageId], set });
}

function messagesOfScope(workspaceId: string, scope: StaleScope): SQL | undefined {
  if ("senderAddress" in scope) {
    return sql`select ${messages.messageId} from ${messages} where ${messages.workspaceId} = ${workspaceId} and lower(${messages.fromAddress}) = ${scope.senderAddress.toLowerCase()}`;
  }
  if ("senderDomain" in scope) {
    return sql`select ${messages.messageId} from ${messages} where ${messages.workspaceId} = ${workspaceId} and ${fromDomain} = ${scope.senderDomain.toLowerCase()}`;
  }
  return undefined;
}

/**
 * Marks evaluations stale: every one, some roles', some messages', or those of one sender's mail.
 * Only the sender scopes mark sender checks stale too (a mark changed); a profile, rule, decision
 * or CV change leaves them current, so re-scoring never needs the mail body. Returns how many
 * rows went stale.
 */
export async function markStale(
  db: Database,
  workspaceId: string,
  scope: StaleScope,
  at: Date,
): Promise<{ evaluations: number; senderChecks: number }> {
  let roleFilter: SQL | undefined;
  if ("roles" in scope) {
    if (scope.roles.length === 0) return { evaluations: 0, senderChecks: 0 };
    roleFilter = or(
      ...scope.roles.map((r) =>
        and(eq(roleEvaluations.messageId, r.messageId), eq(roleEvaluations.position, r.position)),
      ),
    );
  } else if ("messageIds" in scope) {
    if (scope.messageIds.length === 0) return { evaluations: 0, senderChecks: 0 };
    roleFilter = inArray(roleEvaluations.messageId, [...scope.messageIds]);
  } else if (!("all" in scope)) {
    roleFilter = sql`${roleEvaluations.messageId} in (${messagesOfScope(workspaceId, scope)})`;
  }
  const evaluations = await db
    .update(roleEvaluations)
    .set({ stale: true, staleSince: at })
    .where(and(eq(roleEvaluations.workspaceId, workspaceId), roleFilter))
    .returning({ id: roleEvaluations.id });

  const senderScope = messagesOfScope(workspaceId, scope);
  let checks: unknown[] = [];
  if (senderScope) {
    checks = await db
      .update(senderChecks)
      .set({ stale: true, staleSince: at })
      .where(
        and(
          eq(senderChecks.workspaceId, workspaceId),
          sql`${senderChecks.messageId} in (${senderScope})`,
        ),
      )
      .returning({ messageId: senderChecks.messageId });
  }
  return { evaluations: evaluations.length, senderChecks: checks.length };
}

export type WorkState = "missing" | "stale";

/**
 * A job message with something to evaluate. `staleSince` tells a re-staled item apart. `reply`:
 * its reply stage failed and is to run again (stage_failures), even with nothing to evaluate.
 */
export interface ToEvaluate {
  messageId: string;
  sender: { state: WorkState; staleSince: Date | null } | null;
  roles: { position: number; state: WorkState; staleSince: Date | null }[];
  reply: boolean;
}

interface ToEvaluateRow {
  message_id: string;
  sender_work: boolean;
  reply_work: boolean;
  sender_stale: boolean;
  sender_stale_since: string | Date | null;
  roles: { position: number; missing: boolean; staleSince: string | null }[] | string;
}

const toDate = (v: string | Date | null) => (v === null ? null : new Date(v));

/**
 * Job messages whose sender check or any role's evaluation is missing or stale, newest first:
 * the first scan's backlog included (F1.6). A message names only what it needs. A sender check
 * whose stage failed is stored incomplete and listed as missing until it succeeds; a message
 * whose reply stage failed is listed with `reply` until that stage succeeds.
 *
 * With `now`, what still waits out its back-off at that time (./stage-failures.ts) is left out:
 * the sweep asks so, and a deterministic failure isn't retried on every tick. Without it,
 * everything to do is listed, and the pipeline holds back the waiting stages itself
 * (getStageHolds), so a run started for other work doesn't retry them early.
 */
export async function listToEvaluate(
  db: Database,
  workspaceId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<ToEvaluate[]> {
  const limit = options.limit ?? 10_000;
  const senderHeld = options.now ? senderHeldSql("sf", "sc", options.now) : sql`false`;
  const roleHeld = options.now ? roleHeldSql("rf", "e", options.now) : sql`false`;
  const senderWork = sql`((sc.message_id is null or sc.stale or sf.message_id is not null)
    and not ${senderHeld})`;
  const roleWork = sql`(r.position is not null and (e.id is null or e.stale) and not ${roleHeld})`;
  const replyHeld = options.now ? replyHeldSql("pf", options.now) : sql`false`;
  const replyWork = sql`(pf.message_id is not null and not ${replyHeld})`;
  const rows = await queryRows<ToEvaluateRow>(
    db,
    sql`
      select m.message_id,
        ${senderWork} as sender_work,
        ${replyWork} as reply_work,
        coalesce(sc.stale, false) as sender_stale,
        sc.stale_since as sender_stale_since,
        coalesce(
          json_agg(json_build_object(
            'position', r.position, 'missing', e.id is null, 'staleSince', e.stale_since)
            order by r.position)
          filter (where ${roleWork}),
          '[]') as roles
      from messages m
      left join sender_checks sc
        on sc.workspace_id = m.workspace_id and sc.message_id = m.message_id
      left join stage_failures sf on sf.workspace_id = m.workspace_id
        and sf.message_id = m.message_id and sf.stage = 'sender'
      left join stage_failures pf on pf.workspace_id = m.workspace_id
        and pf.message_id = m.message_id and pf.stage = 'reply'
      left join roles r on r.workspace_id = m.workspace_id and r.message_id = m.message_id
      left join role_evaluations e on e.workspace_id = r.workspace_id
        and e.message_id = r.message_id and e.position = r.position
      left join stage_failures rf on rf.workspace_id = r.workspace_id
        and rf.message_id = r.message_id and rf.stage = 'match' and rf.position = r.position
      where m.workspace_id = ${workspaceId}
        and m.stage_one <> 'own_reply' and m.analysis_status = 'done'
        and m.category in (${sql.join(
          JOB_CATEGORIES.map((c) => sql`${c}`),
          sql`, `,
        )})
      group by m.message_id, m.date, sc.message_id, sc.stale, sc.stale_since,
        sf.message_id, sf.retry_at, pf.message_id, pf.retry_at
      having ${senderWork} or bool_or(${roleWork}) or ${replyWork}
      order by m.date desc, m.message_id desc
      limit ${limit}`,
  );
  return rows.map((row) => {
    const list = typeof row.roles === "string" ? JSON.parse(row.roles) : row.roles;
    return {
      messageId: row.message_id,
      sender: !row.sender_work
        ? null
        : row.sender_stale
          ? { state: "stale", staleSince: toDate(row.sender_stale_since) }
          : { state: "missing", staleSince: null },
      roles: (list as { position: number; missing: boolean; staleSince: string | null }[]).map(
        (r) => ({
          position: Number(r.position),
          state: r.missing ? ("missing" as const) : ("stale" as const),
          staleSince: toDate(r.staleSince),
        }),
      ),
      reply: row.reply_work,
    };
  });
}

/** What the pipeline's stages read of one message (apps/server/src/pipeline/stages.ts). */
export interface MessageInputRow {
  /** The row's primary key. */
  id: string;
  messageId: string;
  folder: MailFolder;
  folderPath: string;
  uidValidity: number;
  uid: number;
  receivedAt: Date;
  from: Address;
  subject: string;
  category: Category | null;
  inReplyTo: string | null;
  references: string[];
  /** Every role's facts, in position order. */
  facts: JobFacts[];
  /**
   * The body's language (ISO 639-1), as the sender stage last detected it and the pipeline stored
   * it (saveMessageLanguage); null before a sender check has read the body, or when the stage
   * couldn't tell.
   */
  language: string | null;
}

/** The stage inputs of these messages (any order; unknown ids are left out). */
export async function loadMessageInputs(
  db: Database,
  workspaceId: string,
  messageIds: readonly string[],
): Promise<MessageInputRow[]> {
  if (messageIds.length === 0) return [];
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(eq(messages.workspaceId, workspaceId), inArray(messages.messageId, [...messageIds])),
    );
  const facts = await db
    .select({ messageId: roles.messageId, position: roles.position, facts: roles.facts })
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), inArray(roles.messageId, [...messageIds])))
    .orderBy(asc(roles.messageId), asc(roles.position));
  const byMessage = new Map<string, JobFacts[]>();
  for (const f of facts) {
    const list = byMessage.get(f.messageId) ?? [];
    list.push(f.facts);
    byMessage.set(f.messageId, list);
  }
  return rows.map((m) => ({
    id: m.id,
    messageId: m.messageId,
    folder: m.folder,
    folderPath: m.folderPath,
    uidValidity: m.uidValidity,
    uid: m.uid,
    receivedAt: m.date,
    from: { address: m.fromAddress, name: m.fromName },
    subject: m.subject,
    category: m.category,
    inReplyTo: m.inReplyTo,
    references: m.references,
    facts: byMessage.get(m.messageId) ?? [],
    language: m.language,
  }));
}

/**
 * Stores the language the sender stage detected in the message's body (ISO 639-1, or null). True
 * when it changed, so the caller can re-do what was chosen without it (the CV choice).
 */
export async function saveMessageLanguage(
  db: Database,
  workspaceId: string,
  messageId: string,
  language: string | null,
): Promise<boolean> {
  const rows = await db
    .update(messages)
    .set({ language })
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        eq(messages.messageId, messageId),
        sql`${messages.language} is distinct from ${language}`,
      ),
    )
    .returning({ id: messages.id });
  return rows.length > 0;
}

type EvaluationRow = typeof roleEvaluations.$inferSelect;

/** A stored evaluation as RoleEvaluation. */
export function toRoleEvaluation(row: EvaluationRow): RoleEvaluation {
  const cvChoice: CvChoice = { cvId: row.cvId, reason: row.cvReason, source: row.cvSource };
  return {
    position: row.position,
    match: row.match,
    hidden:
      row.hiddenRuleId && row.hiddenReason !== null
        ? { ruleId: row.hiddenRuleId, reason: row.hiddenReason }
        : null,
    ruleEffects: row.ruleEffects,
    cvChoice,
    stale: row.stale,
    evaluatedAt: row.evaluatedAt.toISOString(),
  };
}

/** The stored evaluations of these messages' roles. */
export async function getEvaluations(
  db: Database,
  workspaceId: string,
  messageIds: readonly string[],
): Promise<(RoleEvaluation & { messageId: string })[]> {
  if (messageIds.length === 0) return [];
  const rows = await db
    .select()
    .from(roleEvaluations)
    .where(
      and(
        eq(roleEvaluations.workspaceId, workspaceId),
        inArray(roleEvaluations.messageId, [...messageIds]),
      ),
    )
    .orderBy(asc(roleEvaluations.messageId), asc(roleEvaluations.position));
  return rows.map((row) => ({ messageId: row.messageId, ...toRoleEvaluation(row) }));
}

/** The stored sender checks of these messages, with whether each is stale. */
export async function getSenderChecks(
  db: Database,
  workspaceId: string,
  messageIds: readonly string[],
): Promise<(SenderCheck & { messageId: string; stale: boolean })[]> {
  if (messageIds.length === 0) return [];
  const rows = await db
    .select()
    .from(senderChecks)
    .where(
      and(
        eq(senderChecks.workspaceId, workspaceId),
        inArray(senderChecks.messageId, [...messageIds]),
      ),
    );
  return rows.map((row) => ({
    messageId: row.messageId,
    verdict: row.verdict,
    complete: row.complete,
    reasons: row.reasons,
    mark: row.mark,
    stale: row.stale,
  }));
}

/**
 * One role as the impact preview reads it (F8.2, F8.5): its facts and message fields, its current
 * evaluation, the sender verdict, its live draft and its draft history.
 */
export interface RoleState extends RoleRef {
  receivedAt: Date;
  category: Category | null;
  from: Address;
  facts: JobFacts;
  evaluation: RoleEvaluation | null;
  sender: { verdict: SenderVerdict; complete: boolean } | null;
  /** The live (not discarded) draft's status. */
  draft: { status: string; failureKind: string | null } | null;
  draftHistory: DraftHistory;
}

/** The state of every role of the workspace's job mail (or of these messages' roles). */
export async function listRoleStates(
  db: Database,
  workspaceId: string,
  options: { messageIds?: readonly string[] } = {},
): Promise<RoleState[]> {
  const only = options.messageIds
    ? inArray(messages.messageId, [...options.messageIds])
    : undefined;
  if (options.messageIds?.length === 0) return [];
  const rows = await db
    .select({
      messageId: messages.messageId,
      date: messages.date,
      category: messages.category,
      fromAddress: messages.fromAddress,
      fromName: messages.fromName,
      position: roles.position,
      facts: roles.facts,
    })
    .from(roles)
    .innerJoin(
      messages,
      and(eq(messages.workspaceId, roles.workspaceId), eq(messages.messageId, roles.messageId)),
    )
    .where(and(eq(roles.workspaceId, workspaceId), isJobMessage, only))
    .orderBy(sql`${messages.date} desc`, asc(messages.messageId), asc(roles.position));
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.messageId))];
  const refs = rows.map((r) => ({ messageId: r.messageId, position: r.position }));
  const [evaluations, checks, history, live] = await Promise.all([
    getEvaluations(db, workspaceId, ids),
    getSenderChecks(db, workspaceId, ids),
    draftHistory(db, workspaceId, refs),
    liveDrafts(db, workspaceId, ids),
  ]);
  const evaluationOf = new Map(evaluations.map((e) => [roleKey(e), e]));
  const checkOf = new Map(checks.map((c) => [c.messageId, c]));
  return rows.map((r) => {
    const key = roleKey(r);
    const evaluation = evaluationOf.get(key);
    const check = checkOf.get(r.messageId);
    return {
      messageId: r.messageId,
      position: r.position,
      receivedAt: r.date,
      category: r.category,
      from: { address: r.fromAddress, name: r.fromName },
      facts: r.facts,
      evaluation: evaluation ? (({ messageId: _m, ...e }) => e)(evaluation) : null,
      sender: check ? { verdict: check.verdict, complete: check.complete } : null,
      draft: live.get(key) ?? null,
      draftHistory: history.get(key) ?? { hadDraft: false, dismissed: false },
    };
  });
}

async function liveDrafts(db: Database, workspaceId: string, messageIds: string[]) {
  const rows = await queryRows<{
    message_id: string;
    position: number;
    status: string;
    failure_kind: string | null;
  }>(
    db,
    sql`select message_id, position, status, failure_kind from drafts
        where workspace_id = ${workspaceId} and status <> 'discarded'
          and message_id in (${sql.join(
            messageIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
  );
  return new Map(
    rows.map((r) => [
      roleKey({ messageId: r.message_id, position: Number(r.position) }),
      { status: r.status, failureKind: r.failure_kind },
    ]),
  );
}

/**
 * The workspaces with pipeline work: a confirmed profile, and something to evaluate at `now`
 * (what waits out a stage's back-off doesn't count) or a draft to retry. Like the job claim, it
 * reads across workspaces (ARCHITECTURE › Workspaces): the sweep
 * (apps/server/src/pipeline/sweep.ts) serves them all and enqueues one re-evaluation for each.
 */
export async function listWorkspacesWithWork(db: Database, now: Date): Promise<string[]> {
  const confirmed = await db
    .selectDistinct({ workspaceId: profiles.workspaceId })
    .from(profiles)
    .where(isNotNull(profiles.confirmedAt));
  const out: string[] = [];
  for (const { workspaceId } of confirmed) {
    if ((await listToEvaluate(db, workspaceId, { limit: 1, now })).length > 0) {
      out.push(workspaceId);
    } else if ((await listDraftsToRetry(db, workspaceId, now)).length > 0) {
      out.push(workspaceId);
    }
  }
  return out;
}
