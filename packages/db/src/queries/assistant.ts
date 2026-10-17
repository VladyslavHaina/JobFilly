import type {
  AnswerSource,
  AssistantClarify,
  Change,
  Impact,
  ProfileSnapshot,
  ProposalStatus,
} from "@jobfilly/schema";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import type { Database } from "../client";
import { assistantMessages, assistantProposals, assistantThreads, decisions } from "../tables";

// The assistant's storage (F8): each member's threads, their messages and the proposals in them.
// Messages and proposals are stored for the history and never logged (F8.10). A thread belongs to
// one member: the thread lookups (getLatestThread, getThread) take the member's user id as well as
// the workspace id. The reads by thread or proposal id (listThreadMessages, listThreadProposals,
// nextTurn, getProposal) take only the workspace id: call them with a thread from a lookup, or
// check the proposal's userId before acting, so nobody reads another member's conversation.
// Proposals change status only while open (Apply or Discard, once).

/** A stored message of a thread. `turn` is shared by the user's message and the reply to it. */
export interface StoredAssistantMessage {
  id: string;
  role: "user" | "assistant";
  turn: number;
  text: string;
  clarify: AssistantClarify | null;
  proposalId: string | null;
  /** MVP 3 (F8.1): the refs an answer used, as the lookups returned them; [] for any other. */
  sources: AnswerSource[];
  /** An answer that read full-access data (message text, drafts): not for a pipeline-only member. */
  fullAccess: boolean;
  at: Date;
}

/** A stored proposal, with the thread's member and the words that led to it. */
export interface StoredProposal {
  id: string;
  threadId: string;
  /** The member whose thread it is. */
  userId: string;
  profileId: string;
  request: string;
  summary: string;
  changes: Change[];
  before: ProfileSnapshot;
  after: ProfileSnapshot;
  impact: Impact;
  status: ProposalStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/** The member's most recent thread in the workspace, or null before their first message. */
export async function getLatestThread(
  db: Database,
  workspaceId: string,
  userId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: assistantThreads.id })
    .from(assistantThreads)
    .where(and(eq(assistantThreads.workspaceId, workspaceId), eq(assistantThreads.userId, userId)))
    .orderBy(desc(assistantThreads.updatedAt), desc(assistantThreads.createdAt))
    .limit(1);
  return row ?? null;
}

/** The thread, if it is this member's in this workspace. */
export async function getThread(
  db: Database,
  workspaceId: string,
  userId: string,
  threadId: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: assistantThreads.id })
    .from(assistantThreads)
    .where(
      and(
        eq(assistantThreads.workspaceId, workspaceId),
        eq(assistantThreads.userId, userId),
        eq(assistantThreads.id, threadId),
      ),
    );
  return row ?? null;
}

/** Starts a thread for the member. */
export async function createThread(
  db: Database,
  workspaceId: string,
  userId: string,
  at: Date,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(assistantThreads)
    .values({ workspaceId, userId, createdAt: at, updatedAt: at })
    .returning({ id: assistantThreads.id });
  if (!row) throw new Error("createThread: no row returned");
  return row;
}

/** The thread's messages, in order. */
export async function listThreadMessages(
  db: Database,
  workspaceId: string,
  threadId: string,
): Promise<StoredAssistantMessage[]> {
  const rows = await db
    .select()
    .from(assistantMessages)
    .where(
      and(eq(assistantMessages.workspaceId, workspaceId), eq(assistantMessages.threadId, threadId)),
    )
    .orderBy(
      asc(assistantMessages.turn),
      asc(assistantMessages.createdAt),
      desc(assistantMessages.role),
    );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    turn: r.turn,
    text: r.text,
    clarify: r.clarify ?? null,
    proposalId: r.proposalId,
    sources: r.sources ?? [],
    fullAccess: r.fullAccess,
    at: r.createdAt,
  }));
}

/** The number of the thread's next turn: 1 for the first message. */
export async function nextTurn(
  db: Database,
  workspaceId: string,
  threadId: string,
): Promise<number> {
  const [row] = await db
    .select({ last: max(assistantMessages.turn) })
    .from(assistantMessages)
    .where(
      and(eq(assistantMessages.workspaceId, workspaceId), eq(assistantMessages.threadId, threadId)),
    );
  return (row?.last ?? 0) + 1;
}

/**
 * Stores one turn: the user's message and the assistant's reply, with its clarifying question,
 * its proposal or the refs its answer used. Pass the transaction that stores the proposal.
 */
export async function saveTurn(
  db: Database,
  workspaceId: string,
  threadId: string,
  input: {
    turn: number;
    text: string;
    reply: string;
    clarify: AssistantClarify | null;
    proposalId: string | null;
    sources?: AnswerSource[];
    /** The reply read what only a member who sees everything may (message text, drafts). */
    fullAccess: boolean;
    at: Date;
  },
): Promise<void> {
  // The reply is stored a millisecond after the message, so the thread reads in order.
  const replyAt = new Date(input.at.getTime() + 1);
  await db.insert(assistantMessages).values([
    {
      workspaceId,
      threadId,
      role: "user",
      turn: input.turn,
      text: input.text,
      // The member's own words: never hidden from them.
      fullAccess: false,
      createdAt: input.at,
    },
    {
      workspaceId,
      threadId,
      role: "assistant",
      turn: input.turn,
      text: input.reply,
      clarify: input.clarify,
      proposalId: input.proposalId,
      sources: input.sources && input.sources.length > 0 ? input.sources : null,
      fullAccess: input.fullAccess,
      createdAt: replyAt,
    },
  ]);
  await db
    .update(assistantThreads)
    .set({ updatedAt: replyAt })
    .where(and(eq(assistantThreads.workspaceId, workspaceId), eq(assistantThreads.id, threadId)));
}

type ProposalRow = typeof assistantProposals.$inferSelect;

const toProposal = (row: ProposalRow, userId: string): StoredProposal => ({
  id: row.id,
  threadId: row.threadId,
  userId,
  profileId: row.profileId,
  request: row.request,
  summary: row.summary,
  changes: row.changes,
  before: row.before,
  after: row.after,
  impact: row.impact,
  status: row.status,
  decidedBy: row.decidedBy,
  decidedAt: row.decidedAt,
  createdAt: row.createdAt,
});

/** What a proposal card holds: its changes in words, before and after, and the impact. */
export interface ProposalContent {
  summary: string;
  changes: Change[];
  before: ProfileSnapshot;
  after: ProfileSnapshot;
  impact: Impact;
}

/** Stores an open proposal in the thread. */
export async function insertProposal(
  db: Database,
  workspaceId: string,
  input: ProposalContent & { threadId: string; profileId: string; request: string; at: Date },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(assistantProposals)
    .values({
      workspaceId,
      threadId: input.threadId,
      profileId: input.profileId,
      request: input.request,
      summary: input.summary,
      changes: input.changes,
      before: input.before,
      after: input.after,
      impact: input.impact,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .returning({ id: assistantProposals.id });
  if (!row) throw new Error("insertProposal: no row returned");
  return row;
}

const proposalColumns = { proposal: assistantProposals, userId: assistantThreads.userId };

const withThread = and(
  eq(assistantThreads.workspaceId, assistantProposals.workspaceId),
  eq(assistantThreads.id, assistantProposals.threadId),
);

/** One proposal of the workspace, with its thread's member, or null. */
export async function getProposal(
  db: Database,
  workspaceId: string,
  proposalId: string,
): Promise<StoredProposal | null> {
  const [row] = await db
    .select(proposalColumns)
    .from(assistantProposals)
    .innerJoin(assistantThreads, withThread)
    .where(
      and(eq(assistantProposals.workspaceId, workspaceId), eq(assistantProposals.id, proposalId)),
    );
  return row ? toProposal(row.proposal, row.userId) : null;
}

/** The thread's proposals, oldest first. */
export async function listThreadProposals(
  db: Database,
  workspaceId: string,
  threadId: string,
): Promise<StoredProposal[]> {
  const rows = await db
    .select(proposalColumns)
    .from(assistantProposals)
    .innerJoin(assistantThreads, withThread)
    .where(
      and(
        eq(assistantProposals.workspaceId, workspaceId),
        eq(assistantProposals.threadId, threadId),
      ),
    )
    .orderBy(asc(assistantProposals.createdAt), asc(assistantProposals.id));
  return rows.map((r) => toProposal(r.proposal, r.userId));
}

const isOpen = (workspaceId: string, proposalId: string) =>
  and(
    eq(assistantProposals.workspaceId, workspaceId),
    eq(assistantProposals.id, proposalId),
    eq(assistantProposals.status, "open"),
  );

/** Replaces an open proposal's content (an edit before Apply, F8.2); false once it is decided. */
export async function updateOpenProposal(
  db: Database,
  workspaceId: string,
  proposalId: string,
  input: ProposalContent & { at: Date },
): Promise<boolean> {
  const rows = await db
    .update(assistantProposals)
    .set({
      summary: input.summary,
      changes: input.changes,
      before: input.before,
      after: input.after,
      impact: input.impact,
      updatedAt: input.at,
    })
    .where(isOpen(workspaceId, proposalId))
    .returning({ id: assistantProposals.id });
  return rows.length > 0;
}

/**
 * Applies or discards an open proposal, once: false when it was decided already. Pass the
 * transaction that applies its changes.
 */
export async function decideProposal(
  db: Database,
  workspaceId: string,
  proposalId: string,
  input: { status: Exclude<ProposalStatus, "open">; userId: string; at: Date },
): Promise<boolean> {
  const rows = await db
    .update(assistantProposals)
    .set({
      status: input.status,
      decidedBy: input.userId,
      decidedAt: input.at,
      updatedAt: input.at,
    })
    .where(isOpen(workspaceId, proposalId))
    .returning({ id: assistantProposals.id });
  return rows.length > 0;
}

/**
 * The question of each decision by group key (an answer's decision link, F8.1): the open one,
 * else the newest answered one. Group keys with no decision are left out.
 */
export async function decisionQuestions(
  db: Database,
  workspaceId: string,
  groupKeys: readonly string[],
): Promise<Map<string, string>> {
  if (groupKeys.length === 0) return new Map();
  const rows = await db
    .select({ groupKey: decisions.groupKey, question: decisions.question })
    .from(decisions)
    .where(and(eq(decisions.workspaceId, workspaceId), inArray(decisions.groupKey, [...groupKeys])))
    // "answered" sorts before "open", each oldest first: the one kept per key is the open one,
    // else the newest.
    .orderBy(asc(decisions.status), asc(decisions.createdAt));
  return new Map(rows.map((r) => [r.groupKey, r.question]));
}
