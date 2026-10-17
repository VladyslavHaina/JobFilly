import {
  type Address,
  type ApplicationStage,
  type Category,
  JOB_CATEGORIES,
  type JobFacts,
  type RoleRef,
} from "@jobfilly/schema";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import { messages, roleStages, roles, sends } from "../tables";

// The application pipeline (MVP 3, F5): what stage derivation reads (roles, their thread's mail
// and categories, the replies sent from the app) and the stages set by hand (role_stages). Only
// a stage set by hand is stored; everything else is derived on read (D15, packages/core
// buildPipeline). Roles and mail of non-job messages are left out, so a member who sees the
// pipeline only gets nothing of them.

/** Everything the pipeline is derived from, for one workspace. */
export interface PipelineRows {
  roles: {
    messageId: string;
    position: number;
    facts: JobFacts;
    from: Address;
    receivedAt: Date;
  }[];
  /** Job mail and the user's own messages: what a stage is read from, and how threads join. */
  mail: {
    messageId: string;
    inReplyTo: string | null;
    references: string[];
    receivedAt: Date;
    category: Category | null;
    own: boolean;
  }[];
  /** Replies to a role sent from the app (F4): the SMTP server took them (sent_at). */
  sent: { messageId: string; position: number; sentAt: Date }[];
  /** Stages set by hand. */
  manual: { messageId: string; position: number; stage: ApplicationStage; setAt: Date }[];
}

const jobMail = inArray(messages.category, [...JOB_CATEGORIES]);

export async function loadPipelineRows(db: Database, workspaceId: string): Promise<PipelineRows> {
  const roleRows = await db
    .select({
      messageId: roles.messageId,
      position: roles.position,
      facts: roles.facts,
      fromAddress: messages.fromAddress,
      fromName: messages.fromName,
      receivedAt: messages.date,
    })
    .from(roles)
    .innerJoin(
      messages,
      and(eq(messages.workspaceId, roles.workspaceId), eq(messages.messageId, roles.messageId)),
    )
    .where(and(eq(roles.workspaceId, workspaceId), jobMail));
  const mail = await db
    .select({
      messageId: messages.messageId,
      inReplyTo: messages.inReplyTo,
      references: messages.references,
      receivedAt: messages.date,
      category: messages.category,
      own: sql<boolean>`${messages.stageOne} = 'own_reply'`,
    })
    .from(messages)
    .where(
      and(eq(messages.workspaceId, workspaceId), or(jobMail, eq(messages.stageOne, "own_reply"))),
    );
  const sent = await db
    .select({ messageId: sends.messageId, position: sends.position, sentAt: sends.sentAt })
    .from(sends)
    .where(and(eq(sends.workspaceId, workspaceId), isNotNull(sends.sentAt)));
  const manual = await db
    .select({
      messageId: roleStages.messageId,
      position: roleStages.position,
      stage: roleStages.stage,
      setAt: roleStages.setAt,
    })
    .from(roleStages)
    .where(eq(roleStages.workspaceId, workspaceId));
  return {
    roles: roleRows.map((r) => ({
      messageId: r.messageId,
      position: r.position,
      facts: r.facts,
      from: { address: r.fromAddress, name: r.fromName },
      receivedAt: r.receivedAt,
    })),
    mail,
    sent: sent.flatMap((s) => (s.sentAt ? [{ ...s, sentAt: s.sentAt }] : [])),
    manual,
  };
}

/**
 * Sets the stage of one item by hand (F5.1), or with null goes back to the derived one. `roles`
 * are every role of the item: a stage set on any of them earlier is replaced, so the item has one.
 */
export async function setRoleStage(
  db: Database,
  workspaceId: string,
  input: {
    roles: readonly RoleRef[];
    role: RoleRef;
    stage: ApplicationStage | null;
    userId: string;
    at: Date;
  },
): Promise<void> {
  const { stage } = input;
  const items = [input.role, ...input.roles];
  await db.transaction(async (tx) => {
    await tx
      .delete(roleStages)
      .where(
        and(
          eq(roleStages.workspaceId, workspaceId),
          or(
            ...items.map((r) =>
              and(eq(roleStages.messageId, r.messageId), eq(roleStages.position, r.position)),
            ),
          ),
        ),
      );
    if (stage === null) return;
    await tx.insert(roleStages).values({
      workspaceId,
      messageId: input.role.messageId,
      position: input.role.position,
      stage,
      setBy: input.userId,
      setAt: input.at,
    });
  });
}
