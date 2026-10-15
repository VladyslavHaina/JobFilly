import {
  type Category,
  type CvChoice,
  type DraftStatus,
  JOB_CATEGORIES,
  MESSAGE_PAGE_SIZE,
  type MessageDetail,
  type MessageList,
  type MessageListItem,
  type MessageRef,
  type SenderVerdict,
} from "@jobfilly/schema";
import { and, asc, count, eq, inArray, isNull, ne, not, or, type SQL, sql } from "drizzle-orm";
import type { Database } from "../client";
import { messages, roleCvChoices, roles } from "../tables";
import { getEvaluations, getSenderChecks } from "./evaluations";

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
//
// From MVP 2 each row carries its best fit score (from a role not hidden, if any), its sender
// verdict, its live draft's status and, for a message whose roles are all hidden by a rule, the
// reason. Such a message is left out of the list unless the Hidden filter asks for exactly those
// (F3.4).

export interface InboxListQuery {
  /** Only this category (not_job included, which shows non-job mail on its own). */
  category?: Category;
  /** Search by sender (name or address) or subject, case-insensitive. */
  q?: string;
  /** Include non-job mail in the unfiltered list (the Show toggle). */
  showNonJob?: boolean;
  /** 1-based page of MESSAGE_PAGE_SIZE messages. */
  page?: number;
  /** Only messages whose roles are all hidden by a rule (the Hidden filter); else none of them. */
  hidden?: boolean;
}

// In a select list drizzle writes the columns of a query's single table without the table's name,
// so `${messages.workspaceId}` inside a subquery there would name the subquery's own column and
// match every row of the workspace. The subqueries below name the outer row in full.
const outerWorkspaceId = sql.raw(`"messages"."workspace_id"`);
const outerMessageId = sql.raw(`"messages"."message_id"`);

const listColumns = {
  messageId: messages.messageId,
  fromAddress: messages.fromAddress,
  fromName: messages.fromName,
  subject: messages.subject,
  date: messages.date,
  category: messages.category,
  categorySource: messages.categorySource,
  analysisStatus: messages.analysisStatus,
  fit: sql<{ score: number; capped: boolean; stale: boolean } | null>`(
    select json_build_object('score', e.score, 'capped', e.capped, 'stale', e.stale)
    from role_evaluations e
    where e.workspace_id = ${outerWorkspaceId} and e.message_id = ${outerMessageId}
      and e.score is not null
    order by (e.hidden_rule_id is null) desc, e.score desc, e.position
    limit 1)`,
  sender: sql<{ verdict: SenderVerdict; complete: boolean } | null>`(
    select json_build_object('verdict', sc.verdict, 'complete', sc.complete)
    from sender_checks sc
    where sc.workspace_id = ${outerWorkspaceId} and sc.message_id = ${outerMessageId})`,
  hiddenReason: sql<string | null>`(
    select e.hidden_reason from role_evaluations e
    where e.workspace_id = ${outerWorkspaceId} and e.message_id = ${outerMessageId}
      and e.hidden_rule_id is not null
    order by e.position limit 1)`,
  draft: sql<{ status: DraftStatus } | null>`(
    select json_build_object('status', d.status) from drafts d
    where d.workspace_id = ${outerWorkspaceId} and d.message_id = ${outerMessageId}
      and d.status <> 'discarded'
    order by d.updated_at desc limit 1)`,
};

/** Every role of the message is evaluated and hidden by a rule (it has at least one). */
const allHidden = sql`(exists (
    select 1 from roles r
    where r.workspace_id = ${outerWorkspaceId} and r.message_id = ${outerMessageId})
  and not exists (
    select 1 from roles r
    left join role_evaluations e on e.workspace_id = r.workspace_id
      and e.message_id = r.message_id and e.position = r.position
    where r.workspace_id = ${outerWorkspaceId} and r.message_id = ${outerMessageId}
      and (e.id is null or e.hidden_rule_id is null)))`;

interface ListRow {
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  date: Date;
  category: Category | null;
  categorySource: MessageListItem["categorySource"];
  analysisStatus: MessageListItem["analysisStatus"];
  fit: MessageListItem["fit"];
  sender: MessageListItem["sender"];
  hiddenReason: string | null;
  draft: MessageListItem["draft"];
  allHidden?: boolean;
}

const asJson = <T>(value: T | string | null): T | null =>
  typeof value === "string" ? (JSON.parse(value) as T) : value;

function toListItem(row: ListRow): MessageListItem {
  return {
    id: row.messageId,
    from: { address: row.fromAddress, name: row.fromName },
    subject: row.subject,
    date: row.date.toISOString(),
    category: row.category,
    categorySource: row.categorySource,
    analysisStatus: row.analysisStatus,
    fit: asJson(row.fit),
    sender: asJson(row.sender),
    hidden: row.allHidden && row.hiddenReason !== null ? { reason: row.hiddenReason } : null,
    draft: asJson(row.draft),
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
  const hiddenFilter = query.hidden ? allHidden : not(allHidden);

  const rows = await db
    .select({ ...listColumns, allHidden: sql<boolean>`${allHidden}` })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), notOwnReply, shown, search, hiddenFilter))
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
 * One message with every role it names (a job alert lists several), each with its facts, its
 * evaluation and the CV the app would use, and the sender check; null when the workspace has no
 * message with this Message-ID. Own replies open too, marked as such.
 */
export async function getInboxMessage(
  db: Database,
  workspaceId: string,
  messageId: string,
): Promise<MessageDetail | null> {
  const [row] = await db
    .select({ ...listColumns, stageOne: messages.stageOne, allHidden: sql<boolean>`${allHidden}` })
    .from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.messageId, messageId)));
  if (!row) return null;
  const facts = await db
    .select({ position: roles.position, facts: roles.facts })
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), eq(roles.messageId, messageId)))
    .orderBy(asc(roles.position));
  const evaluations = new Map(
    (await getEvaluations(db, workspaceId, [messageId])).map((e) => [e.position, e]),
  );
  const overrides = new Map(
    (
      await db
        .select({ position: roleCvChoices.position, cvId: roleCvChoices.cvId })
        .from(roleCvChoices)
        .where(
          and(eq(roleCvChoices.workspaceId, workspaceId), eq(roleCvChoices.messageId, messageId)),
        )
    ).map((o) => [o.position, o.cvId]),
  );
  const [check] = await getSenderChecks(db, workspaceId, [messageId]);
  return {
    ...toListItem(row),
    roles: facts.map((f) => {
      const stored = evaluations.get(f.position);
      const evaluation = stored ? (({ messageId: _m, ...e }) => e)(stored) : null;
      return {
        ...f.facts,
        evaluation,
        cvChoice: cvChoiceOf(evaluation?.cvChoice ?? null, overrides.get(f.position)),
      };
    }),
    ownReply: row.stageOne === "own_reply",
    senderCheck: check
      ? {
          verdict: check.verdict,
          complete: check.complete,
          reasons: check.reasons,
          mark: check.mark,
        }
      : null,
  };
}

/** An editor's override wins over the evaluated (automatic) choice until it is re-evaluated. */
function cvChoiceOf(evaluated: CvChoice | null, override: string | undefined): CvChoice | null {
  if (override === undefined) return evaluated;
  if (evaluated?.source === "you" && evaluated.cvId === override) return evaluated;
  return { cvId: override, reason: "Chosen by an editor for this role", source: "you" };
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
