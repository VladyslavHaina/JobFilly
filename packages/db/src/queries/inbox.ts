import {
  type Category,
  JOB_CATEGORIES,
  MESSAGE_PAGE_SIZE,
  type MessageDetail,
  type MessageList,
  type MessageListItem,
  type MessageRef,
} from "@jobfilly/schema";
import { and, asc, count, eq, inArray, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "../client";
import { messages, roles } from "../tables";

// The job inbox (F5): the list with filters, search and paging, one message's detail, where its
// body lives in the mailbox, and the category correction. Which rows show where follows the state
// table in ./messages.ts:
//
//   - listed: a job category, or "Couldn't analyze" (analysis failed before any category was set);
//   - behind the Show toggle, and counted: category not_job (as the scan or a person set it);
//   - never listed: the user's own replies, and likely job mail the model hasn't read yet. Their
//     detail still opens by Message-ID, since intake evidence links point at them.
//
// The list is newest first. A category filter matches the (workspace_id, category, date desc)
// index, the plain list the (workspace_id, date desc) one, and the search the pg_trgm index on
// search_text; ORDER BY spells out NULLS LAST so it matches the indexes' order.

export interface InboxListQuery {
  /** Only this category (not_job included, which shows non-job mail on its own). */
  category?: Category;
  /** Search by sender (name or address) or subject, case-insensitive. */
  q?: string;
  /** Include non-job mail in the unfiltered list (the Show toggle). */
  showNonJob?: boolean;
  /** 1-based page of MESSAGE_PAGE_SIZE messages. */
  page?: number;
}

type ListRow = Pick<
  typeof messages.$inferSelect,
  | "messageId"
  | "fromAddress"
  | "fromName"
  | "subject"
  | "date"
  | "category"
  | "categorySource"
  | "analysisStatus"
>;

const listColumns = {
  messageId: messages.messageId,
  fromAddress: messages.fromAddress,
  fromName: messages.fromName,
  subject: messages.subject,
  date: messages.date,
  category: messages.category,
  categorySource: messages.categorySource,
  analysisStatus: messages.analysisStatus,
};

function toListItem(row: ListRow): MessageListItem {
  return {
    id: row.messageId,
    from: { address: row.fromAddress, name: row.fromName },
    subject: row.subject,
    date: row.date.toISOString(),
    category: row.category,
    categorySource: row.categorySource,
    analysisStatus: row.analysisStatus,
  };
}

/** `term` as a LIKE pattern matching it anywhere, its wildcards taken literally. */
function containsPattern(term: string): string {
  return `%${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const notOwnReply = ne(messages.stageOne, "own_reply");
const jobMail = inArray(messages.category, [...JOB_CATEGORIES]);
const couldNotAnalyze = and(isNull(messages.category), eq(messages.analysisStatus, "failed"));
const nonJob = eq(messages.category, "not_job");

/** One page of the job inbox, newest first, with the count of non-job mail it hides. */
export async function listInbox(
  db: Database,
  workspaceId: string,
  query: InboxListQuery = {},
): Promise<MessageList> {
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const term = query.q?.trim();
  const search: SQL | undefined = term
    ? sql`${messages.searchText} like ${containsPattern(term)}`
    : undefined;

  let shown: SQL | undefined;
  if (query.category) shown = eq(messages.category, query.category);
  else if (query.showNonJob) shown = or(jobMail, couldNotAnalyze, nonJob);
  else shown = or(jobMail, couldNotAnalyze);

  const rows = await db
    .select(listColumns)
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), notOwnReply, shown, search))
    .orderBy(sql`${messages.date} desc nulls last`, sql`${messages.messageId} desc`)
    .limit(MESSAGE_PAGE_SIZE + 1)
    .offset((page - 1) * MESSAGE_PAGE_SIZE);

  const [hidden] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), notOwnReply, nonJob, search));

  return {
    items: rows.slice(0, MESSAGE_PAGE_SIZE).map(toListItem),
    nonJobCount: hidden?.n ?? 0,
    page,
    nextPage: rows.length > MESSAGE_PAGE_SIZE ? page + 1 : null,
  };
}

/**
 * One message with the facts of every role it names (a job alert lists several), or null when
 * the workspace has no message with this Message-ID. Own replies open too, marked as such.
 */
export async function getInboxMessage(
  db: Database,
  workspaceId: string,
  messageId: string,
): Promise<MessageDetail | null> {
  const [row] = await db
    .select({ ...listColumns, stageOne: messages.stageOne })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.messageId, messageId)));
  if (!row) return null;
  const facts = await db
    .select({ facts: roles.facts })
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), eq(roles.messageId, messageId)))
    .orderBy(asc(roles.position));
  return {
    ...toListItem(row),
    roles: facts.map((f) => f.facts),
    ownReply: row.stageOne === "own_reply",
  };
}

/**
 * Where the message lives in the mailbox (folder path, UIDVALIDITY, UID), to fetch its body on
 * demand; null for an unknown Message-ID. The body itself is never stored.
 */
export async function getMessageRef(
  db: Database,
  workspaceId: string,
  messageId: string,
): Promise<MessageRef | null> {
  const [row] = await db
    .select({
      folderPath: messages.folderPath,
      uidValidity: messages.uidValidity,
      uid: messages.uid,
    })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.messageId, messageId)));
  return row ?? null;
}

/**
 * A person corrects a message's category (F5.4). The source becomes "you", which saveAnalysis
 * never overwrites. The user's own replies have no category to correct.
 */
export async function correctCategory(
  db: Database,
  workspaceId: string,
  messageId: string,
  category: Category,
): Promise<"corrected" | "own_reply" | "not_found"> {
  const updated = await db
    .update(messages)
    .set({ category, categorySource: "you", updatedAt: sql`now()` })
    .where(
      and(eq(messages.workspaceId, workspaceId), eq(messages.messageId, messageId), notOwnReply),
    )
    .returning({ id: messages.id });
  if (updated.length > 0) return "corrected";
  const [exists] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.messageId, messageId)));
  return exists ? "own_reply" : "not_found";
}
