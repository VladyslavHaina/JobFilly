import {
  type Category,
  type Envelope,
  type IntakeInput,
  type JobFacts,
  MESSAGE_GONE_SIGNAL,
  type Preferences,
  type StageOneResult,
  type StageOneVerdict,
  type StoredMessage,
} from "@jobfilly/schema";
import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import { messages, roles, senderChecks } from "../tables";

// Message metadata, snippets and extracted facts (never bodies). A message is named by its RFC
// Message-ID, unique per workspace, so saving the same envelopes again (a resumed scan) is
// harmless.
//
// The state of a row, as the scan writes it and the job inbox reads it:
//
//   stage_one   | after saveEnvelopes                  | after the model
//   ------------+--------------------------------------+-------------------------------------
//   not_job     | category not_job (scan), done        | (never sent to the model)
//   job_alert   | category job_alert (scan), pending   | saveAnalysis: roles, done
//   likely_job  | category null, pending               | saveAnalysis: category + roles, done
//               |                                      | markAnalysisFailed: failed
//   own_reply   | category null, pending               | savePreferences: done
//
// The job inbox lists rows with a job category or analysis_status failed ("Couldn't analyze"),
// never own replies; category not_job is counted behind the Show toggle; likely_job and
// job_alert rows still pending are the "N more likely job emails not analyzed". A category whose
// source is "you" (a correction) is never overwritten.

type MessageRow = typeof messages.$inferSelect;

function envelopeColumns(e: Envelope) {
  return {
    folder: e.folder,
    folderPath: e.folderPath,
    uidValidity: e.uidValidity,
    uid: e.uid,
    fromAddress: e.from.address,
    fromName: e.from.name,
    toAddresses: e.to,
    ccAddresses: e.cc,
    replyTo: e.replyTo,
    inReplyTo: e.inReplyTo,
    references: e.references,
    listId: e.listId,
    listUnsubscribe: e.listUnsubscribe,
    precedence: e.precedence,
    autoSubmitted: e.autoSubmitted,
    date: new Date(e.date),
    subject: e.subject,
    snippet: e.snippet,
  };
}

/** The analysis state a new row starts in, by its stage-one verdict (the table above). */
function initialAnalysis(verdict: StageOneVerdict) {
  if (verdict === "not_job") {
    return { category: "not_job", categorySource: "scan", analysisStatus: "done" } as const;
  }
  if (verdict === "job_alert") {
    return { category: "job_alert", categorySource: "scan", analysisStatus: "pending" } as const;
  }
  return { category: null, categorySource: null, analysisStatus: "pending" } as const;
}

function toEnvelope(row: MessageRow): Envelope {
  return {
    messageId: row.messageId,
    folder: row.folder,
    folderPath: row.folderPath,
    uidValidity: row.uidValidity,
    uid: row.uid,
    date: row.date.toISOString(),
    from: { address: row.fromAddress, name: row.fromName },
    to: row.toAddresses,
    cc: row.ccAddresses,
    replyTo: row.replyTo,
    inReplyTo: row.inReplyTo,
    references: row.references,
    subject: row.subject,
    listId: row.listId,
    listUnsubscribe: row.listUnsubscribe,
    precedence: row.precedence,
    autoSubmitted: row.autoSubmitted,
    snippet: row.snippet,
  };
}

function toStored(row: MessageRow): StoredMessage {
  return {
    envelope: toEnvelope(row),
    stageOne: row.stageOne,
    stageOneReason: row.stageOneReason,
    category: row.category,
    categorySource: row.categorySource,
    analysisStatus: row.analysisStatus,
    analyzedByScanId: row.analyzedByScanId,
  };
}

const CHUNK = 200;

/**
 * Saves envelopes with their stage-one verdicts. A new row starts in the state its verdict gives
 * it; an existing row (same Message-ID) gets its headers and verdict refreshed and keeps its
 * category, analysis and roles. The scan and the sync (a UIDVALIDITY re-index too, F1.3) save
 * what they see through here, so a sender check made while the message couldn't be found in the
 * mailbox (the message_gone signal) goes stale: the message is there again, under the reference
 * just saved, and its sender is checked again with its text.
 */
export async function saveEnvelopes(
  db: Database,
  workspaceId: string,
  items: readonly StageOneResult[],
): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await db
      .insert(messages)
      .values(
        chunk.map(({ envelope, verdict, reason }) => ({
          workspaceId,
          messageId: envelope.messageId,
          ...envelopeColumns(envelope),
          stageOne: verdict,
          stageOneReason: reason,
          ...initialAnalysis(verdict),
        })),
      )
      .onConflictDoUpdate({
        target: [messages.workspaceId, messages.messageId],
        set: {
          folder: sql`excluded.folder`,
          folderPath: sql`excluded.folder_path`,
          uidValidity: sql`excluded.uid_validity`,
          uid: sql`excluded.uid`,
          fromAddress: sql`excluded.from_address`,
          fromName: sql`excluded.from_name`,
          toAddresses: sql`excluded.to_addresses`,
          ccAddresses: sql`excluded.cc_addresses`,
          replyTo: sql`excluded.reply_to`,
          inReplyTo: sql`excluded.in_reply_to`,
          references: sql`excluded."references"`,
          listId: sql`excluded.list_id`,
          listUnsubscribe: sql`excluded.list_unsubscribe`,
          precedence: sql`excluded.precedence`,
          autoSubmitted: sql`excluded.auto_submitted`,
          date: sql`excluded.date`,
          subject: sql`excluded.subject`,
          snippet: sql`excluded.snippet`,
          stageOne: sql`excluded.stage_one`,
          stageOneReason: sql`excluded.stage_one_reason`,
          updatedAt: sql`now()`,
        },
      });
    await db
      .update(senderChecks)
      .set({ stale: true, staleSince: sql`now()` })
      .where(
        and(
          eq(senderChecks.workspaceId, workspaceId),
          inArray(
            senderChecks.messageId,
            chunk.map((item) => item.envelope.messageId),
          ),
          eq(senderChecks.stale, false),
          sql`${senderChecks.reasons} @> ${JSON.stringify([{ signal: MESSAGE_GONE_SIGNAL }])}::jsonb`,
        ),
      );
  }
}

/**
 * Re-indexing by Message-ID (F1.3): the stored messages among these envelopes get the folder,
 * UIDVALIDITY and UID the mailbox gives them now, and nothing else changes. The row, its id and
 * everything that hangs off the Message-ID stay: a category a person corrected, roles,
 * evaluations, sender checks and marks, decision links and drafts. A sender check made while
 * the message couldn't be found (message_gone) goes stale, as in saveEnvelopes. Returns the
 * Message-IDs that were stored; the others are new to the workspace. A message without a
 * Message-ID header has a synthetic id built from its UIDVALIDITY and UID, so a rebuilt folder
 * gives it a new one: it can't be matched and comes back as new.
 */
export async function reindexMessages(
  db: Database,
  workspaceId: string,
  envelopes: readonly Envelope[],
): Promise<Set<string>> {
  // One location per Message-ID: of two copies in the folder, the newest (highest UID) wins.
  const byId = new Map<string, Envelope>();
  for (const e of envelopes) {
    const seen = byId.get(e.messageId);
    if (!seen || e.uid > seen.uid) byId.set(e.messageId, e);
  }
  const found = new Set<string>();
  const unique = [...byId.values()];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const locations = JSON.stringify(
      chunk.map((e) => ({
        message_id: e.messageId,
        folder: e.folder,
        folder_path: e.folderPath,
        uid_validity: e.uidValidity,
        uid: e.uid,
      })),
    );
    const updated = await db
      .update(messages)
      .set({
        folder: sql`v.folder`,
        folderPath: sql`v.folder_path`,
        uidValidity: sql`v.uid_validity`,
        uid: sql`v.uid`,
        updatedAt: sql`now()`,
      })
      .from(
        sql`jsonb_to_recordset(${locations}::jsonb) as v(message_id text, folder text, folder_path text, uid_validity bigint, uid bigint)`,
      )
      .where(and(eq(messages.workspaceId, workspaceId), sql`${messages.messageId} = v.message_id`))
      .returning({ messageId: messages.messageId });
    for (const row of updated) found.add(row.messageId);
    if (updated.length === 0) continue;
    await db
      .update(senderChecks)
      .set({ stale: true, staleSince: sql`now()` })
      .where(
        and(
          eq(senderChecks.workspaceId, workspaceId),
          inArray(
            senderChecks.messageId,
            updated.map((row) => row.messageId),
          ),
          eq(senderChecks.stale, false),
          sql`${senderChecks.reasons} @> ${JSON.stringify([{ signal: MESSAGE_GONE_SIGNAL }])}::jsonb`,
        ),
      );
  }
  return found;
}

/**
 * Where the stored messages of a folder end (the first sync's start, F1.1): the UIDVALIDITY of
 * the folder's newest stored message and the highest UID stored under it; null when none is.
 * What the first scan stored is then not read again, and nothing older than its window is read.
 */
export async function newestStoredUid(
  db: Database,
  workspaceId: string,
  folderPath: string,
): Promise<{ uidValidity: number; uid: number } | null> {
  const inFolder = and(eq(messages.workspaceId, workspaceId), eq(messages.folderPath, folderPath));
  const [newest] = await db
    .select({ uidValidity: messages.uidValidity })
    .from(messages)
    .where(inFolder)
    .orderBy(desc(messages.date), desc(messages.uid))
    .limit(1);
  if (!newest) return null;
  const [row] = await db
    .select({ uid: sql<string>`max(${messages.uid})` })
    .from(messages)
    .where(and(inFolder, eq(messages.uidValidity, newest.uidValidity)));
  return { uidValidity: newest.uidValidity, uid: Number(row?.uid ?? 0) };
}

/** The stored rows of these Message-IDs (any order; unknown ids are left out). */
export async function getStoredMessages(
  db: Database,
  workspaceId: string,
  messageIds: readonly string[],
): Promise<StoredMessage[]> {
  if (messageIds.length === 0) return [];
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(eq(messages.workspaceId, workspaceId), inArray(messages.messageId, [...messageIds])),
    );
  return rows.map(toStored);
}

const pendingLikely = (workspaceId: string) =>
  and(
    eq(messages.workspaceId, workspaceId),
    inArray(messages.stageOne, ["likely_job", "job_alert"]),
    eq(messages.analysisStatus, "pending"),
  );

/**
 * Likely job messages (likely_job and job_alert) not analysed yet, newest first. `before` pages
 * on (date, Message-ID): only rows older than that position are returned.
 */
export async function listPendingCandidates(
  db: Database,
  workspaceId: string,
  options: { limit: number; before?: { date: string; messageId: string } },
): Promise<StoredMessage[]> {
  const before = options.before;
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        pendingLikely(workspaceId),
        before
          ? sql`(${messages.date}, ${messages.messageId}) < (${new Date(before.date)}, ${before.messageId})`
          : undefined,
      ),
    )
    .orderBy(desc(messages.date), desc(messages.messageId))
    .limit(options.limit);
  return rows.map(toStored);
}

/** The user's own replies whose preferences haven't been read yet, newest first. */
export async function listPendingOwnReplies(
  db: Database,
  workspaceId: string,
  options: { limit: number },
): Promise<StoredMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        eq(messages.stageOne, "own_reply"),
        eq(messages.analysisStatus, "pending"),
      ),
    )
    .orderBy(desc(messages.date), desc(messages.messageId))
    .limit(options.limit);
  return rows.map(toStored);
}

/** How many likely job messages are still waiting for the model ("N more … not analyzed"). */
export async function countNotAnalyzed(db: Database, workspaceId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(messages).where(pendingLikely(workspaceId));
  return row?.n ?? 0;
}

/**
 * What one scan run has done with likely job mail, counted from the rows themselves so a run
 * taken over by another replica counts what the previous one stored after its last checkpoint:
 * `analyzed` is every likely job message the run analysed or marked "Couldn't analyze", `jobFound`
 * those whose category is job mail.
 */
export async function countScanAnalysis(
  db: Database,
  workspaceId: string,
  scanId: string,
): Promise<{ analyzed: number; jobFound: number }> {
  const [row] = await db
    .select({
      analyzed: count(),
      jobFound: count(
        sql`case when ${messages.analysisStatus} = 'done' and ${messages.category} <> 'not_job' then 1 end`,
      ),
    })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        eq(messages.analyzedByScanId, scanId),
        inArray(messages.stageOne, ["likely_job", "job_alert"]),
        ne(messages.analysisStatus, "pending"),
      ),
    );
  return { analyzed: row?.analyzed ?? 0, jobFound: row?.jobFound ?? 0 };
}

/**
 * Stores the model's analysis of one message: its category (unless a person corrected it, which
 * is kept for good) and its roles, which replace any earlier ones. False for an unknown message.
 */
export async function saveAnalysis(
  db: Database,
  workspaceId: string,
  input: {
    messageId: string;
    scanId: string | null;
    category: Category;
    roles: readonly JobFacts[];
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(messages)
      .set({
        category: sql`case when ${messages.categorySource} = 'you' then ${messages.category} else ${input.category} end`,
        categorySource: sql`case when ${messages.categorySource} = 'you' then 'you' else 'scan' end`,
        analysisStatus: "done",
        analyzedByScanId: input.scanId,
        updatedAt: sql`now()`,
      })
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.messageId, input.messageId)))
      .returning({ id: messages.id });
    if (updated.length === 0) return false;
    await tx
      .delete(roles)
      .where(and(eq(roles.workspaceId, workspaceId), eq(roles.messageId, input.messageId)));
    if (input.roles.length > 0) {
      await tx.insert(roles).values(
        input.roles.map((facts, position) => ({
          workspaceId,
          messageId: input.messageId,
          position,
          facts,
        })),
      );
    }
    return true;
  });
}

/** Marks a message "Couldn't analyze" after its retry also failed (F3.4). */
export async function markAnalysisFailed(
  db: Database,
  workspaceId: string,
  input: { messageId: string; scanId: string | null },
): Promise<boolean> {
  const rows = await db
    .update(messages)
    .set({ analysisStatus: "failed", analyzedByScanId: input.scanId, updatedAt: sql`now()` })
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.messageId, input.messageId)))
    .returning({ id: messages.id });
  return rows.length > 0;
}

/** Stores what one of the user's own replies states (prefs.v1). */
export async function savePreferences(
  db: Database,
  workspaceId: string,
  input: { messageId: string; scanId: string | null; preferences: Preferences },
): Promise<boolean> {
  const rows = await db
    .update(messages)
    .set({
      preferences: input.preferences,
      analysisStatus: "done",
      analyzedByScanId: input.scanId,
      updatedAt: sql`now()`,
    })
    .where(and(eq(messages.workspaceId, workspaceId), eq(messages.messageId, input.messageId)))
    .returning({ id: messages.id });
  return rows.length > 0;
}

/** The roles of one message, in their order. */
export async function getRoles(
  db: Database,
  workspaceId: string,
  messageId: string,
): Promise<JobFacts[]> {
  const rows = await db
    .select({ facts: roles.facts })
    .from(roles)
    .where(and(eq(roles.workspaceId, workspaceId), eq(roles.messageId, messageId)))
    .orderBy(asc(roles.position));
  return rows.map((r) => r.facts);
}

/**
 * What the intake aggregation reads, newest first: the preferences of the user's analysed
 * replies, and the roles of every analysed job message. not_job (as corrected by the user, too)
 * and failed messages are left out.
 */
export async function loadIntakeInput(db: Database, workspaceId: string): Promise<IntakeInput> {
  const replies = await db
    .select({
      messageId: messages.messageId,
      date: messages.date,
      preferences: messages.preferences,
    })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        eq(messages.stageOne, "own_reply"),
        eq(messages.analysisStatus, "done"),
        isNotNull(messages.preferences),
      ),
    )
    .orderBy(desc(messages.date), desc(messages.messageId));

  const jobRows = await db
    .select({
      messageId: messages.messageId,
      date: messages.date,
      category: messages.category,
      position: roles.position,
      facts: roles.facts,
    })
    .from(messages)
    .leftJoin(
      roles,
      and(eq(roles.workspaceId, messages.workspaceId), eq(roles.messageId, messages.messageId)),
    )
    .where(
      and(
        eq(messages.workspaceId, workspaceId),
        ne(messages.stageOne, "own_reply"),
        eq(messages.analysisStatus, "done"),
        isNotNull(messages.category),
        ne(messages.category, "not_job"),
      ),
    )
    .orderBy(desc(messages.date), desc(messages.messageId), asc(roles.position));

  const jobs: IntakeInput["jobs"] = [];
  for (const row of jobRows) {
    let last = jobs.at(-1);
    if (!last || last.messageId !== row.messageId) {
      last = {
        messageId: row.messageId,
        date: row.date.toISOString(),
        category: row.category as Category,
        roles: [],
      };
      jobs.push(last);
    }
    if (row.facts) last.roles.push(row.facts);
  }

  return {
    replies: replies.map((r) => ({
      messageId: r.messageId,
      date: r.date.toISOString(),
      preferences: r.preferences ?? {},
    })),
    jobs,
  };
}
