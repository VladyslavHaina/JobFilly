import type {
  Decision,
  DecisionChoice,
  DecisionNeed,
  DecisionStatus,
  ProfileItem,
  ProfileKey,
} from "@jobfilly/schema";
import { and, asc, eq, exists, inArray, ne, notInArray, sql } from "drizzle-orm";
import type { Database } from "../client";
import { decisionMessages, decisions, messages } from "../tables";
import { releaseDraftClaim } from "./draft-claims";
import type { RoleRef } from "./evaluations";

// The decision inbox (F7): one open decision per group key (decisions_one_open_idx), and the roles
// waiting on it in decision_messages, each waiting, dismissed ("Don't ask for this message",
// F7.5) or resolved (the decision was answered). A decision is listed while it is open and some
// role still waits on it; one with nobody left waiting leaves the inbox, and a later role that
// needs the same answer joins it again.

/** One group of needs to record: a decision's question and the roles waiting on it. */
export interface NeedGroupInput {
  groupKey: string;
  profileKey: ProfileKey | null;
  question: string;
  choices: DecisionChoice[];
  waiting: { messageId: string; position: number; source: DecisionNeed["source"] }[];
}

/**
 * Records needs: each group joins its open decision, or opens one, and its roles wait on it
 * (a role already listed keeps its state, so a dismissal stays). With `reopen` a role the user
 * dismissed waits on it again, and a role already waiting takes the new source: Draft a reply
 * asked for the reply, and it can't go without the answer (F6.5, F7.5). Returns the decisions it
 * opened, for decision.created, and how many roles started waiting.
 */
export async function recordNeeds(
  db: Database,
  workspaceId: string,
  groups: readonly NeedGroupInput[],
  now: Date,
  options: { reopen?: boolean } = {},
): Promise<{ created: { id: string; groupKey: string }[]; added: number }> {
  const created: { id: string; groupKey: string }[] = [];
  let added = 0;
  for (const group of groups) {
    const [opened] = await db
      .insert(decisions)
      .values({
        workspaceId,
        groupKey: group.groupKey,
        profileKey: group.profileKey,
        question: group.question,
        choices: group.choices,
        status: "open",
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [decisions.workspaceId, decisions.groupKey],
        where: sql`status = 'open'`,
      })
      .returning({ id: decisions.id });
    let id = opened?.id;
    if (opened) {
      created.push({ id: opened.id, groupKey: group.groupKey });
    } else {
      const [open] = await db
        .select({ id: decisions.id })
        .from(decisions)
        .where(
          and(
            eq(decisions.workspaceId, workspaceId),
            eq(decisions.groupKey, group.groupKey),
            eq(decisions.status, "open"),
          ),
        );
      id = open?.id;
    }
    if (!id || group.waiting.length === 0) continue;
    if (options.reopen) {
      for (const w of group.waiting) {
        await db
          .update(decisionMessages)
          .set({ source: w.source, updatedAt: now })
          .where(
            and(
              eq(decisionMessages.workspaceId, workspaceId),
              eq(decisionMessages.decisionId, id),
              eq(decisionMessages.messageId, w.messageId),
              eq(decisionMessages.position, w.position),
              eq(decisionMessages.state, "waiting"),
              ne(decisionMessages.source, w.source),
            ),
          );
      }
    }
    const insert = db.insert(decisionMessages).values(
      group.waiting.map((w) => ({
        decisionId: id,
        workspaceId,
        messageId: w.messageId,
        position: w.position,
        state: "waiting" as const,
        source: w.source,
        createdAt: now,
        updatedAt: now,
      })),
    );
    const inserted = await (options.reopen
      ? insert.onConflictDoUpdate({
          target: [
            decisionMessages.decisionId,
            decisionMessages.messageId,
            decisionMessages.position,
          ],
          set: { state: "waiting", source: sql`excluded.source`, updatedAt: now },
          setWhere: sql`${decisionMessages.state} = 'dismissed'`,
        })
      : insert.onConflictDoNothing()
    ).returning({ decisionId: decisionMessages.decisionId });
    added += inserted.length;
  }
  return { created, added };
}

/**
 * Lets go of a draft claim whose draft.v1 answer raised questions and records them as needs, in
 * one transaction (ARCHITECTURE › The draft lifecycle): the role counts as never drafted and
 * waits on the decisions. Nothing is recorded when the claim was no longer saving. `reopen` as
 * for recordNeeds (the claim is Draft a reply's).
 */
export async function releaseClaimWithNeeds(
  db: Database,
  workspaceId: string,
  draftId: string,
  groups: readonly NeedGroupInput[],
  now: Date,
  options: { reopen?: boolean } = {},
): Promise<{ released: boolean; created: { id: string; groupKey: string }[] }> {
  return db.transaction(async (tx) => {
    if (!(await releaseDraftClaim(tx, workspaceId, draftId)))
      return { released: false, created: [] };
    const { created } = await recordNeeds(tx, workspaceId, groups, now, options);
    return { released: true, created };
  });
}

/** One role's place on a decision, with the decision. */
export interface RoleDecision extends RoleRef {
  decisionId: string;
  groupKey: string;
  profileKey: ProfileKey | null;
  question: string;
  choices: DecisionChoice[];
  decisionStatus: DecisionStatus;
  /** The answer, once the decision is answered. */
  answer: ProfileItem | null;
  state: "waiting" | "dismissed" | "resolved";
  source: DecisionNeed["source"];
}

/** Every decision these roles are on, whatever its state. */
export async function roleDecisions(
  db: Database,
  workspaceId: string,
  roles: readonly RoleRef[],
): Promise<RoleDecision[]> {
  if (roles.length === 0) return [];
  const ids = [...new Set(roles.map((r) => r.messageId))];
  const rows = await db
    .select({
      messageId: decisionMessages.messageId,
      position: decisionMessages.position,
      state: decisionMessages.state,
      source: decisionMessages.source,
      decisionId: decisions.id,
      groupKey: decisions.groupKey,
      profileKey: decisions.profileKey,
      question: decisions.question,
      choices: decisions.choices,
      decisionStatus: decisions.status,
      answer: decisions.answer,
    })
    .from(decisionMessages)
    .innerJoin(decisions, eq(decisions.id, decisionMessages.decisionId))
    .where(
      and(
        eq(decisionMessages.workspaceId, workspaceId),
        eq(decisions.workspaceId, workspaceId),
        inArray(decisionMessages.messageId, ids),
      ),
    )
    .orderBy(asc(decisions.createdAt));
  const wanted = new Set(roles.map((r) => `${r.messageId}#${r.position}`));
  return rows
    .filter((r) => wanted.has(`${r.messageId}#${r.position}`))
    .map((r) => ({
      ...r,
      profileKey: r.profileKey as ProfileKey | null,
      answer: r.answer ?? null,
    }));
}

/**
 * A role stops waiting on every decision but those with `groupKeys` (its needs changed, or it
 * isn't a reply candidate any more, F7.1). Dismissed and resolved places stay. Returns how many
 * it left.
 */
export async function keepWaiting(
  db: Database,
  workspaceId: string,
  role: RoleRef,
  groupKeys: readonly string[],
): Promise<number> {
  const others = db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.workspaceId, workspaceId),
        eq(decisions.id, decisionMessages.decisionId),
        groupKeys.length > 0 ? notInArray(decisions.groupKey, [...groupKeys]) : undefined,
      ),
    );
  const rows = await db
    .delete(decisionMessages)
    .where(
      and(
        eq(decisionMessages.workspaceId, workspaceId),
        eq(decisionMessages.messageId, role.messageId),
        eq(decisionMessages.position, role.position),
        eq(decisionMessages.state, "waiting"),
        exists(others),
      ),
    )
    .returning({ decisionId: decisionMessages.decisionId });
  return rows.length;
}

const waitingSelect = {
  decisionId: decisionMessages.decisionId,
  messageId: decisionMessages.messageId,
  position: decisionMessages.position,
  subject: messages.subject,
};

async function waitingOn(db: Database, workspaceId: string, decisionIds: readonly string[]) {
  if (decisionIds.length === 0) return new Map<string, Decision["waiting"]>();
  const rows = await db
    .select(waitingSelect)
    .from(decisionMessages)
    .innerJoin(
      messages,
      and(
        eq(messages.workspaceId, decisionMessages.workspaceId),
        eq(messages.messageId, decisionMessages.messageId),
      ),
    )
    .where(
      and(
        eq(decisionMessages.workspaceId, workspaceId),
        inArray(decisionMessages.decisionId, [...decisionIds]),
        eq(decisionMessages.state, "waiting"),
      ),
    )
    .orderBy(asc(messages.date), asc(decisionMessages.position));
  const out = new Map<string, Decision["waiting"]>();
  for (const r of rows) {
    const list = out.get(r.decisionId) ?? [];
    list.push({ messageId: r.messageId, position: r.position, subject: r.subject });
    out.set(r.decisionId, list);
  }
  return out;
}

type DecisionRow = typeof decisions.$inferSelect;

/** A stored decision, with its answer. */
export interface StoredDecision extends Decision {
  answer: ProfileItem | null;
}

function toDecision(row: DecisionRow, waiting: Decision["waiting"]): StoredDecision {
  return {
    id: row.id,
    question: row.question,
    profileKey: row.profileKey as ProfileKey | null,
    groupKey: row.groupKey,
    choices: row.choices,
    waiting,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    answer: row.answer ?? null,
  };
}

const someoneWaits = exists(
  sql`(select 1 from ${decisionMessages} where ${decisionMessages.decisionId} = ${decisions.id} and ${decisionMessages.state} = 'waiting')`,
);

/** The decision inbox: open decisions some role waits on, oldest first (F7.2). */
export async function listDecisions(db: Database, workspaceId: string): Promise<StoredDecision[]> {
  const rows = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.workspaceId, workspaceId), eq(decisions.status, "open"), someoneWaits))
    .orderBy(asc(decisions.createdAt), asc(decisions.groupKey));
  const waiting = await waitingOn(
    db,
    workspaceId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toDecision(r, waiting.get(r.id) ?? []));
}

/** How many decisions the inbox lists, for the count in the navigation. */
export async function countOpenDecisions(db: Database, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(decisions)
    .where(and(eq(decisions.workspaceId, workspaceId), eq(decisions.status, "open"), someoneWaits));
  return row?.n ?? 0;
}

export async function getDecision(
  db: Database,
  workspaceId: string,
  decisionId: string,
): Promise<StoredDecision | null> {
  const [row] = await db
    .select()
    .from(decisions)
    .where(and(eq(decisions.workspaceId, workspaceId), eq(decisions.id, decisionId)));
  if (!row) return null;
  const waiting = await waitingOn(db, workspaceId, [row.id]);
  return toDecision(row, waiting.get(row.id) ?? []);
}

/** What `alsoWrite` gave back: whether to keep the answer, and its own result. */
export interface AnswerWrite<W> {
  keep: boolean;
  value: W;
}

export type AnswerOutcome<W> =
  | { status: "answered"; roles: RoleRef[]; written: W | null }
  | { status: "not_open" }
  /** `alsoWrite` refused: nothing was written, and the decision is still open. */
  | { status: "refused"; written: W };

/** Rolls the answer's transaction back when `alsoWrite` refuses. */
class Refused<W> extends Error {
  constructor(readonly written: W) {
    super("refused");
  }
}

/**
 * Answers an open decision (F7.4): it is answered with `answer`, and every role waiting on it is
 * resolved. `alsoWrite` runs in the same transaction once the decision is claimed (the profile
 * entry of "Use this answer for similar mail"): when it refuses, nothing is written, and two
 * answers racing for one decision never both reach the profile. Returns the resolved roles, or
 * not_open when the decision isn't open.
 */
export async function answerDecision<W = never>(
  db: Database,
  workspaceId: string,
  decisionId: string,
  input: { answer: ProfileItem; userId: string | null; now: Date },
  alsoWrite?: (tx: Database) => Promise<AnswerWrite<W>>,
): Promise<AnswerOutcome<W>> {
  try {
    return await db.transaction(async (tx): Promise<AnswerOutcome<W>> => {
      const [row] = await tx
        .update(decisions)
        .set({
          status: "answered",
          answer: input.answer,
          answeredBy: input.userId,
          answeredAt: input.now,
        })
        .where(
          and(
            eq(decisions.workspaceId, workspaceId),
            eq(decisions.id, decisionId),
            eq(decisions.status, "open"),
          ),
        )
        .returning({ id: decisions.id });
      if (!row) return { status: "not_open" };
      const roles = await tx
        .update(decisionMessages)
        .set({ state: "resolved", updatedAt: input.now })
        .where(
          and(
            eq(decisionMessages.workspaceId, workspaceId),
            eq(decisionMessages.decisionId, decisionId),
            eq(decisionMessages.state, "waiting"),
          ),
        )
        .returning({ messageId: decisionMessages.messageId, position: decisionMessages.position });
      if (!alsoWrite) return { status: "answered", roles, written: null };
      const write = await alsoWrite(tx);
      if (!write.keep) throw new Refused(write.value);
      return { status: "answered", roles, written: write.value };
    });
  } catch (error) {
    if (error instanceof Refused) return { status: "refused", written: error.written as W };
    throw error;
  }
}

/**
 * "Don't ask for this message" (F7.5): the role stops waiting on the decision for good, and it
 * never gets an automatic draft (draftHistory's dismissed). False when it wasn't waiting on it.
 */
export async function dismissDecisionRole(
  db: Database,
  workspaceId: string,
  decisionId: string,
  role: RoleRef,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(decisionMessages)
    .set({ state: "dismissed", updatedAt: now })
    .where(
      and(
        eq(decisionMessages.workspaceId, workspaceId),
        eq(decisionMessages.decisionId, decisionId),
        eq(decisionMessages.messageId, role.messageId),
        eq(decisionMessages.position, role.position),
        eq(decisionMessages.state, "waiting"),
      ),
    )
    .returning({ decisionId: decisionMessages.decisionId });
  return rows.length > 0;
}
