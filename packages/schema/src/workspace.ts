import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";

/** viewer reads; editor also works the job search; admin also manages the workspace. */
export const RoleSchema = z.enum(["viewer", "editor", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/** True when `role` includes everything `needed` may do. */
export function roleAtLeast(role: Role, needed: Role): boolean {
  return RANK[role] >= RANK[needed];
}

export const WorkspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  ownerId: z.uuid(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

/** One workspace the signed-in user belongs to, with their role in it. */
export const WorkspaceSummarySchema = WorkspaceSchema.extend({
  role: RoleSchema,
  isOwner: z.boolean(),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const WorkspaceListSchema = z.object({ items: z.array(WorkspaceSummarySchema) });
export type WorkspaceList = z.infer<typeof WorkspaceListSchema>;

export const MemberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: RoleSchema,
  isOwner: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;

export const MemberListSchema = z.object({ items: z.array(MemberSchema) });
export type MemberList = z.infer<typeof MemberListSchema>;

/** The path of /members/:userId. */
export const MemberParamsSchema = z.object({ userId: IdSchema });
export type MemberParams = z.infer<typeof MemberParamsSchema>;

export const ChangeRoleInputSchema = z.object({ role: RoleSchema });
export type ChangeRoleInput = z.infer<typeof ChangeRoleInputSchema>;

/** Invites expire 7 days after they are created (F1.6). */
export const INVITE_TTL_DAYS = 7;

export const InviteStatusSchema = z.enum(["pending", "accepted", "declined", "revoked", "expired"]);
export type InviteStatus = z.infer<typeof InviteStatusSchema>;

export const InviteSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: RoleSchema,
  status: InviteStatusSchema,
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema,
});
export type Invite = z.infer<typeof InviteSchema>;

/** The path of /invites/:inviteId, for the admin revoking and the invitee answering. */
export const InviteParamsSchema = z.object({ inviteId: IdSchema });
export type InviteParams = z.infer<typeof InviteParamsSchema>;

export const InviteListSchema = z.object({ items: z.array(InviteSchema) });
export type InviteList = z.infer<typeof InviteListSchema>;

export const CreateInviteInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: "Enter a valid email address" })),
  role: RoleSchema,
});
export type CreateInviteInput = z.infer<typeof CreateInviteInputSchema>;

/** The answer to creating an invite: the link is shown once, for the admin to copy. */
export const CreatedInviteSchema = z.object({ invite: InviteSchema, link: z.url() });
export type CreatedInvite = z.infer<typeof CreatedInviteSchema>;

/** An invitation waiting for the signed-in user. */
export const PendingInvitationSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  invitedBy: z.string(),
  role: RoleSchema,
  expiresAt: IsoDateTimeSchema,
});
export type PendingInvitation = z.infer<typeof PendingInvitationSchema>;

export const PendingInvitationListSchema = z.object({ items: z.array(PendingInvitationSchema) });
export type PendingInvitationList = z.infer<typeof PendingInvitationListSchema>;

/**
 * Accepting or declining: the signed-in user's email must be the invited one, or the request
 * carries the token from the copied link.
 */
export const InviteResponseInputSchema = z.object({ token: z.string().min(1).optional() });
export type InviteResponseInput = z.infer<typeof InviteResponseInputSchema>;

/** The query of GET /api/invites/:inviteId: the token of a copied link, when there is one. */
export const InviteLinkQuerySchema = z.object({ token: z.string().optional() });
export type InviteLinkQuery = z.infer<typeof InviteLinkQuerySchema>;

export const AcceptedInviteSchema = z.object({ workspace: WorkspaceSummarySchema });
export type AcceptedInvite = z.infer<typeof AcceptedInviteSchema>;
