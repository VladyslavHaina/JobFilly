import { timingSafeEqual } from "node:crypto";
import {
  createInvite,
  listInvites,
  listMembers,
  listWorkspacesForUser,
  removeMember,
  revokeInvite,
  setMemberRole,
} from "@jobfilly/db";
import {
  ChangeRoleInputSchema,
  type CreatedInvite,
  CreateInviteInputSchema,
  INVITE_TTL_DAYS,
  type InviteList,
  type MemberList,
  type WorkspaceList,
} from "@jobfilly/schema";
import { Hono } from "hono";
import type { SignedInEnv, WorkspaceEnv } from "../access/env";
import { NOT_FOUND, requireRole } from "../access/membership";
import { validJson } from "../access/validate";
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

// GET /api/workspaces: the workspaces the signed-in user belongs to, with their role (F1.7).
export function workspacesRoutes(deps: AppDeps) {
  return new Hono<SignedInEnv>().get("/", requireUser, async (c) =>
    c.json({
      items: await listWorkspacesForUser(deps.db, c.get("user").id),
    } satisfies WorkspaceList),
  );
}

// /api/workspaces/:workspaceId/members: members read, admins change roles and remove (F1.8).
export function membersRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), async (c) =>
      c.json({ items: await listMembers(deps.db, c.get("workspaceId")) } satisfies MemberList),
    )
    .patch("/:userId", requireRole("admin"), validJson(ChangeRoleInputSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const memberId = c.req.param("userId");
      const { role } = c.req.valid("json");
      const result = await setMemberRole(deps.db, workspaceId, memberId, role);
      if (result === "owner") return c.json(OWNER, 409);
      if (result === "not_found") return c.json(NOT_FOUND, 404);
      c.get("log").info("workspace.role_changed", { memberId, role });
      await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
      return c.json({ items: await listMembers(deps.db, workspaceId) } satisfies MemberList);
    })
    .delete("/:userId", requireRole("admin"), async (c) => {
      const workspaceId = c.get("workspaceId");
      const result = await removeMember(deps.db, workspaceId, c.req.param("userId"));
      if (result === "owner") return c.json(OWNER, 409);
      if (result === "not_found") return c.json(NOT_FOUND, 404);
      await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
      return c.body(null, 204);
    });
}

// /api/workspaces/:workspaceId/invites: admins invite by email with a role, get a link to copy,
// and revoke; invites expire after 7 days (F1.6).
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
        tokenHash: hashToken(token),
        invitedBy: c.get("user").id,
        now,
        expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY),
      });
      const link = new URL(`/invites/${invite.id}`, deps.config.publicUrl);
      link.searchParams.set("token", token);
      c.get("log").info("workspace.invite_created", { inviteId: invite.id, role: invite.role });
      await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
      return c.json({ invite, link: link.toString() } satisfies CreatedInvite, 201);
    })
    .delete("/:inviteId", requireRole("admin"), async (c) => {
      const workspaceId = c.get("workspaceId");
      const revoked = await revokeInvite(
        deps.db,
        workspaceId,
        c.req.param("inviteId"),
        deps.clock.now(),
      );
      if (!revoked) return c.json(NOT_FOUND, 404);
      await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
      return c.body(null, 204);
    });
}
