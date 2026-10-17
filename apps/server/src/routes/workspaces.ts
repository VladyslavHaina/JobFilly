import { timingSafeEqual } from "node:crypto";
import {
  createInvite,
  listInvites,
  listMembers,
  listWorkspacesForUser,
  recordActivity,
  removeMember,
  revokeInvite,
  setMemberRole,
  setMemberScope,
  transferOwnership,
} from "@jobfilly/db";
import {
  type ActivityRecord,
  ChangeMemberInputSchema,
  type CreatedInvite,
  CreateInviteInputSchema,
  INVITE_TTL_DAYS,
  type InviteList,
  InviteParamsSchema,
  type MemberList,
  MemberParamsSchema,
  roleAtLeast,
  scopeOf,
  TransferOwnershipInputSchema,
  type WorkspaceList,
} from "@jobfilly/schema";
import { Hono } from "hono";
import {
  FORBIDDEN,
  NOT_FOUND,
  requireRole,
  type SignedInEnv,
  validJson,
  validParam,
  type WorkspaceEnv,
} from "../access";
import { hashToken, newToken, requireUser } from "../auth/session";
import { DAY } from "../clock";
import type { AppDeps } from "../deps";

const OWNER = { error: "owner", message: "The owner is always an admin and can't be removed" };

/** True when `token` is the one whose hash was stored (constant time). */
export function tokenMatches(token: string | undefined, storedHash: string): boolean {
  if (!token) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Records a sharing action of the signed-in member in the workspace's log (MVP 3, F9.1). */
function recordBy(
  deps: AppDeps,
  workspaceId: string,
  userId: string,
  record: Omit<ActivityRecord, "actor">,
): Promise<void> {
  return recordActivity(
    deps.db,
    workspaceId,
    { ...record, actor: { kind: "user", userId } },
    deps.clock.now(),
  );
}

// GET /api/workspaces: the workspaces the signed-in user belongs to, with their role (F1.7).
export function workspacesRoutes(deps: AppDeps) {
  return new Hono<SignedInEnv>().get("/", requireUser, async (c) =>
    c.json({
      items: await listWorkspacesForUser(deps.db, c.get("user").id),
    } satisfies WorkspaceList),
  );
}

// /api/workspaces/:workspaceId/members: members read; admins change roles and what a member sees,
// and remove members; every member but the owner can leave; the owner hands the workspace to
// another admin (F1.8, MVP 3 F6.1, F6.3).
export function membersRoutes(deps: AppDeps) {
  return (
    new Hono<WorkspaceEnv>()
      .get("/", requireRole("viewer"), async (c) =>
        c.json({ items: await listMembers(deps.db, c.get("workspaceId")) } satisfies MemberList),
      )
      .patch(
        "/:userId",
        requireRole("admin"),
        validParam(MemberParamsSchema),
        validJson(ChangeMemberInputSchema),
        async (c) => {
          const workspaceId = c.get("workspaceId");
          const memberId = c.req.valid("param").userId;
          const { role, scope } = c.req.valid("json");
          const member = (await listMembers(deps.db, workspaceId)).find(
            (m) => m.userId === memberId,
          );
          if (!member) return c.json(NOT_FOUND, 404);
          if (member.isOwner) return c.json(OWNER, 409);
          const me = c.get("user").id;
          // Only what changes is changed, logged and recorded.
          if (role !== undefined && role !== member.role) {
            const result = await setMemberRole(deps.db, workspaceId, memberId, role);
            if (result === "owner") return c.json(OWNER, 409);
            if (result === "not_found") return c.json(NOT_FOUND, 404);
            // MVP 1's event and MVP 3's name the same change.
            c.get("log").info("workspace.role_changed", { memberId, role });
            c.get("log").info("member.role_changed", { memberId, role });
            await recordBy(deps, workspaceId, me, {
              kind: "member.role_changed",
              targetUserId: memberId,
              refs: { role },
            });
          }
          if (scope !== undefined && scope !== scopeOf(member)) {
            const result = await setMemberScope(deps.db, workspaceId, memberId, scope);
            if (result === "owner") return c.json(OWNER, 409);
            if (result === "not_found") return c.json(NOT_FOUND, 404);
            c.get("log").info("member.scope_changed", { memberId, scope });
            await recordBy(deps, workspaceId, me, {
              kind: "member.scope_changed",
              targetUserId: memberId,
              refs: { scope },
            });
          }
          await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
          return c.json({ items: await listMembers(deps.db, workspaceId) } satisfies MemberList);
        },
      )
      // An admin removes a member; any member removes themselves (leaves). Never the owner.
      .delete("/:userId", requireRole("viewer"), validParam(MemberParamsSchema), async (c) => {
        const workspaceId = c.get("workspaceId");
        const userId = c.req.valid("param").userId;
        const me = c.get("user").id;
        const leaving = userId === me;
        if (!leaving && !roleAtLeast(c.get("membership").role, "admin")) {
          return c.json(FORBIDDEN, 403);
        }
        const result = await removeMember(deps.db, workspaceId, userId);
        if (result === "owner") return c.json(OWNER, 409);
        if (result === "not_found") return c.json(NOT_FOUND, 404);
        if (leaving) {
          c.get("log").info("member.left");
          await recordBy(deps, workspaceId, me, {
            kind: "member.left",
            targetUserId: null,
            refs: {},
          });
        } else {
          c.get("log").info("member.removed", { memberId: userId });
          await recordBy(deps, workspaceId, me, {
            kind: "member.removed",
            targetUserId: userId,
            refs: {},
          });
        }
        // Their open live-update streams close on every replica before anything else is sent.
        await deps.live.revoke({ type: "member.removed", workspaceId, userId });
        await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
        return c.body(null, 204);
      })
      .post(
        "/:userId/ownership",
        requireRole("admin"),
        validParam(MemberParamsSchema),
        validJson(TransferOwnershipInputSchema),
        async (c) => {
          const workspaceId = c.get("workspaceId");
          const memberId = c.req.valid("param").userId;
          const me = c.get("user").id;
          const result = await transferOwnership(deps.db, workspaceId, me, memberId);
          if (result === "not_found") return c.json(NOT_FOUND, 404);
          if (result === "not_owner") {
            return c.json(
              { error: "not_owner", message: "Only the owner can hand over the workspace" },
              403,
            );
          }
          if (result === "not_admin") {
            return c.json(
              { error: "not_admin", message: "Make them an admin first: the owner is always one" },
              409,
            );
          }
          c.get("log").info("workspace.ownership_transferred", { memberId });
          await recordBy(deps, workspaceId, me, {
            kind: "workspace.ownership_transferred",
            targetUserId: memberId,
            refs: {},
          });
          await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
          return c.json({ items: await listMembers(deps.db, workspaceId) } satisfies MemberList);
        },
      )
  );
}

// /api/workspaces/:workspaceId/invites: admins invite by email with a role and what the member
// will see, get a link to copy, and revoke; invites expire after 7 days (F1.6, MVP 3 F6.1).
export function workspaceInvitesRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("admin"), async (c) =>
      c.json({
        items: await listInvites(deps.db, c.get("workspaceId"), deps.clock.now()),
      } satisfies InviteList),
    )
    .post("/", requireRole("admin"), validJson(CreateInviteInputSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const input = c.req.valid("json");
      const members = await listMembers(deps.db, workspaceId);
      if (members.some((m) => m.email === input.email)) {
        return c.json({ error: "already_member", message: "They are already a member" }, 409);
      }
      const token = newToken();
      const now = deps.clock.now();
      const invite = await createInvite(deps.db, workspaceId, {
        email: input.email,
        role: input.role,
        scope: input.scope,
        tokenHash: hashToken(token),
        invitedBy: c.get("user").id,
        now,
        expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY),
      });
      const link = new URL(`/invites/${invite.id}`, deps.config.publicUrl);
      link.searchParams.set("token", token);
      c.get("log").info("workspace.invite_created", { inviteId: invite.id, role: invite.role });
      await recordBy(deps, workspaceId, c.get("user").id, {
        kind: "member.invited",
        targetUserId: null,
        refs: { inviteId: invite.id, role: invite.role, scope: invite.scope },
      });
      await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
      return c.json({ invite, link: link.toString() } satisfies CreatedInvite, 201);
    })
    .delete("/:inviteId", requireRole("admin"), validParam(InviteParamsSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const revoked = await revokeInvite(
        deps.db,
        workspaceId,
        c.req.valid("param").inviteId,
        deps.clock.now(),
      );
      if (!revoked) return c.json(NOT_FOUND, 404);
      await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
      return c.body(null, 204);
    });
}
