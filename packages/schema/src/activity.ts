import { z } from "zod";
import { IsoDateTimeSchema } from "./common";
import { MemberScopeSchema, RoleSchema } from "./workspace";

// The activity log (MVP 3, F9): the outward and sharing actions of a workspace — drafts saved to
// the mailbox, mail sent, members invited, changed and removed, exports, deletions — with who,
// when and what. Admins read it; it is part of the export and goes with the workspace. A row
// holds ids, never a name or an address, so a deleted account leaves none behind: its actions
// stay and show "Deleted user" (F7.3).

export const ACTIVITY_KINDS = [
  "draft.saved",
  "mail.sent",
  "member.invited",
  "member.role_changed",
  "member.scope_changed",
  "member.removed",
  "member.left",
  "workspace.ownership_transferred",
  "export.downloaded",
  "mailbox.disconnected",
  "account.deleted",
] as const;
export const ActivityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

/** What the actor is called once their account is gone (F7.3). */
export const DELETED_USER = "Deleted user";

/**
 * What an action was about, by id only. Each kind uses the fields it needs: a draft and its role
 * (draft.saved, mail.sent), the member and their new role or scope (member.*), a mailbox
 * (mailbox.disconnected).
 */
export const ActivityRefsSchema = z.object({
  draftId: z.uuid().optional(),
  sendId: z.uuid().optional(),
  messageId: z.string().min(1).optional(),
  position: z.number().int().nonnegative().optional(),
  mailboxId: z.uuid().optional(),
  role: RoleSchema.optional(),
  scope: MemberScopeSchema.optional(),
});
export type ActivityRefs = z.infer<typeof ActivityRefsSchema>;

/**
 * One action as packages/db records it (recordActivity): who did it (a user, or the app itself
 * for an automatic draft), whom it was about when that is a member, and its refs.
 */
export const ActivityRecordSchema = z.object({
  kind: ActivityKindSchema,
  actor: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("user"), userId: z.uuid() }),
    z.object({ kind: z.literal("system") }),
  ]),
  targetUserId: z.uuid().nullable(),
  refs: ActivityRefsSchema,
});
export type ActivityRecord = z.infer<typeof ActivityRecordSchema>;

/** A person in the log: their name, or DELETED_USER once the account is gone (userId null). */
const ActivityPersonSchema = z.object({ userId: z.uuid().nullable(), name: z.string() });

/** One entry of GET /activity, newest first: who, when, and what in plain words. */
export const ActivityEntrySchema = z.object({
  id: z.uuid(),
  at: IsoDateTimeSchema,
  kind: ActivityKindSchema,
  /** Null when the app did it on its own (an automatic draft). */
  actor: ActivityPersonSchema.nullable(),
  target: ActivityPersonSchema.nullable(),
  /** What, in plain words ("Reply to Senior Backend Engineer at Nordlicht"). */
  what: z.string(),
  refs: ActivityRefsSchema,
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const ActivityListSchema = z.object({
  items: z.array(ActivityEntrySchema),
  /** The `before` of the next page, null at the end. */
  nextBefore: IsoDateTimeSchema.nullable(),
});
export type ActivityList = z.infer<typeof ActivityListSchema>;

export const ActivityQuerySchema = z.object({ before: IsoDateTimeSchema.optional() });
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;
