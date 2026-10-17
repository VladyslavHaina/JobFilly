import type { ExportPart } from "@jobfilly/schema";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { PgColumn, PgTable, SelectedFields } from "drizzle-orm/pg-core";
import type { Database } from "../client";
import {
  cvs,
  decisions,
  drafts,
  messages,
  profiles,
  roleEvaluations,
  roleStages,
  roles,
  rules,
} from "../tables";

// The workspace export (MVP 3, F7.1), read in pages so memory stays flat: each part is read
// `limit` rows at a time, in the order of its table's id, and the server writes each page into
// the ZIP before it reads the next. No part holds a secret: mailbox credentials and the AI key
// are not exported, and a CV's file is read one at a time (exportCvFile). Deleting a workspace
// and an account are in ./workspaces and ./accounts (F7.2, F7.3); the activity log is read with
// listActivity (./activity).

/** The parts read here; `activity` is read with listActivity. */
export type ExportTablePart = Exclude<ExportPart, "activity">;

/** A page of one part: plain JSON rows, and where the next page starts (null at the end). */
export interface ExportPage {
  rows: Record<string, unknown>[];
  after: string | null;
}

interface Source {
  table: PgTable;
  /** The key the pages follow (a uuid); not part of the rows. */
  key: PgColumn;
  workspaceId: PgColumn;
  fields: SelectedFields;
  join?: { table: PgTable; on: ReturnType<typeof and> };
}

const SOURCES: Record<ExportTablePart, Source> = {
  profiles: {
    table: profiles,
    key: profiles.id,
    workspaceId: profiles.workspaceId,
    fields: {
      id: profiles.id,
      name: profiles.name,
      enabled: profiles.enabled,
      entries: profiles.entries,
      confirmedAt: profiles.confirmedAt,
      createdBy: profiles.createdBy,
      createdAt: profiles.createdAt,
      updatedAt: profiles.updatedAt,
    },
  },
  rules: {
    table: rules,
    key: rules.id,
    workspaceId: rules.workspaceId,
    fields: {
      id: rules.id,
      profileId: rules.profileId,
      description: rules.description,
      conditions: rules.conditions,
      action: rules.action,
      enabled: rules.enabled,
      source: rules.source,
      createdBy: rules.createdBy,
      createdAt: rules.createdAt,
      updatedAt: rules.updatedAt,
    },
  },
  cvs: {
    table: cvs,
    key: cvs.id,
    workspaceId: cvs.workspaceId,
    fields: {
      id: cvs.id,
      name: cvs.name,
      fileName: cvs.fileName,
      mediaType: cvs.mediaType,
      sizeBytes: cvs.sizeBytes,
      contentHash: cvs.contentHash,
      tags: cvs.tags,
      preferred: cvs.preferred,
      readStatus: cvs.readStatus,
      metadata: cvs.metadata,
      createdBy: cvs.createdBy,
      createdAt: cvs.createdAt,
    },
  },
  // Metadata only: bodies are never stored (the mailbox is the source of truth for mail).
  messages: {
    table: messages,
    key: messages.id,
    workspaceId: messages.workspaceId,
    fields: {
      messageId: messages.messageId,
      mailboxId: messages.mailboxId,
      folder: messages.folder,
      date: messages.date,
      fromAddress: messages.fromAddress,
      fromName: messages.fromName,
      to: messages.toAddresses,
      cc: messages.ccAddresses,
      replyTo: messages.replyTo,
      inReplyTo: messages.inReplyTo,
      references: messages.references,
      listId: messages.listId,
      subject: messages.subject,
      snippet: messages.snippet,
      category: messages.category,
      categorySource: messages.categorySource,
      language: messages.language,
      preferences: messages.preferences,
    },
  },
  facts: {
    table: roles,
    key: roles.id,
    workspaceId: roles.workspaceId,
    fields: { messageId: roles.messageId, position: roles.position, facts: roles.facts },
  },
  matches: {
    table: roleEvaluations,
    key: roleEvaluations.id,
    workspaceId: roleEvaluations.workspaceId,
    fields: {
      messageId: roleEvaluations.messageId,
      position: roleEvaluations.position,
      score: roleEvaluations.score,
      capped: roleEvaluations.capped,
      match: roleEvaluations.match,
      hiddenRuleId: roleEvaluations.hiddenRuleId,
      hiddenReason: roleEvaluations.hiddenReason,
      ruleEffects: roleEvaluations.ruleEffects,
      cvId: roleEvaluations.cvId,
      cvReason: roleEvaluations.cvReason,
      cvSource: roleEvaluations.cvSource,
      profileId: roleEvaluations.profileId,
      profileReason: roleEvaluations.profileReason,
      profileSource: roleEvaluations.profileSource,
      stale: roleEvaluations.stale,
      evaluatedAt: roleEvaluations.evaluatedAt,
    },
  },
  decisions: {
    table: decisions,
    key: decisions.id,
    workspaceId: decisions.workspaceId,
    fields: {
      id: decisions.id,
      question: decisions.question,
      profileKey: decisions.profileKey,
      choices: decisions.choices,
      status: decisions.status,
      answer: decisions.answer,
      answeredBy: decisions.answeredBy,
      answeredAt: decisions.answeredAt,
      createdAt: decisions.createdAt,
      roles: sql`(select coalesce(json_agg(json_build_object('messageId', dm.message_id,
        'position', dm.position, 'state', dm.state, 'source', dm.source)
        order by dm.message_id, dm.position), '[]'::json)
        from decision_messages dm where dm.decision_id = ${decisions.id})`,
    },
  },
  drafts: {
    table: drafts,
    key: drafts.id,
    workspaceId: drafts.workspaceId,
    fields: {
      id: drafts.id,
      messageId: drafts.messageId,
      position: drafts.position,
      status: drafts.status,
      origin: drafts.origin,
      subject: drafts.subject,
      body: drafts.body,
      language: drafts.language,
      cvId: drafts.cvId,
      attachmentName: drafts.attachmentName,
      mailboxFolder: drafts.mailboxFolder,
      draftMessageId: drafts.draftMessageId,
      failureKind: drafts.failureKind,
      failureReason: drafts.failureReason,
      createdBy: drafts.createdBy,
      createdAt: drafts.createdAt,
      updatedAt: drafts.updatedAt,
    },
  },
  // The stages set by hand (F5.1), paged by their role; a derived stage follows from the
  // messages' categories.
  pipeline: {
    table: roleStages,
    key: roles.id,
    workspaceId: roleStages.workspaceId,
    fields: {
      messageId: roleStages.messageId,
      position: roleStages.position,
      stage: roleStages.stage,
      setBy: roleStages.setBy,
      setAt: roleStages.setAt,
    },
    join: {
      table: roles,
      on: and(
        eq(roles.workspaceId, roleStages.workspaceId),
        eq(roles.messageId, roleStages.messageId),
        eq(roles.position, roleStages.position),
      ),
    },
  },
};

/** One page of a part of the workspace's export: rows after `after` (from the start when null). */
export async function exportPage(
  db: Database,
  workspaceId: string,
  part: ExportTablePart,
  after: string | null,
  limit: number,
): Promise<ExportPage> {
  const source = SOURCES[part];
  const base = db.select({ ...source.fields, exportKey: source.key }).from(source.table);
  const joined = source.join ? base.innerJoin(source.join.table, source.join.on) : base;
  const rows = (await joined
    .where(and(eq(source.workspaceId, workspaceId), after ? gt(source.key, after) : undefined))
    .orderBy(asc(source.key))
    .limit(limit)) as (Record<string, unknown> & { exportKey: string })[];
  return {
    rows: rows.map(({ exportKey: _, ...row }) => row),
    after: rows.length === limit ? (rows.at(-1)?.exportKey ?? null) : null,
  };
}

/** The workspace's CV files, by id and file name, oldest first (the export's manifest). */
export async function listCvFiles(
  db: Database,
  workspaceId: string,
): Promise<{ id: string; fileName: string }[]> {
  return db
    .select({ id: cvs.id, fileName: cvs.fileName })
    .from(cvs)
    .where(eq(cvs.workspaceId, workspaceId))
    .orderBy(asc(cvs.id));
}

/** One CV's file, or null when it is gone. */
export async function exportCvFile(
  db: Database,
  workspaceId: string,
  cvId: string,
): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ content: cvs.content })
    .from(cvs)
    .where(and(eq(cvs.workspaceId, workspaceId), eq(cvs.id, cvId)));
  return row?.content ?? null;
}
