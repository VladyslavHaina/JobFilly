import {
  acceptInvite,
  declineInvite,
  getInviteForResponse,
  type InviteForResponse,
  listPendingInvitations,
} from "@jobfilly/db";
import {
  type AcceptedInvite,
  InviteLinkQuerySchema,
  InviteParamsSchema,
  InviteResponseInputSchema,
  type PendingInvitationList,
  type User,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { NOT_FOUND, type SignedInEnv, validJson, validParam, validQuery } from "../access";
import { requireUser } from "../auth/session";
import type { AppDeps } from "../deps";
import { tokenMatches } from "./workspaces";

const NOT_PENDING = { error: "not_pending", message: "This invitation is no longer valid" };

/** The invite, when the signed-in user may answer it: it was sent to their email, or they hold the link. */
async function inviteFor(
  deps: AppDeps,
  inviteId: string,
  user: User,
  token: string | undefined,
): Promise<InviteForResponse | null> {
  const invite = await getInviteForResponse(deps.db, inviteId, deps.clock.now());
  if (!invite) return null;
  const mine = invite.email === user.email.toLowerCase() || tokenMatches(token, invite.tokenHash);
  return mine ? invite : null;
}

// /api/invites: the signed-in user's invitations, accepting and declining them (F1.6).
export function invitesRoutes(deps: AppDeps) {
  return new Hono<SignedInEnv>()
    .use(requireUser)
    .get("/", async (c) =>
      c.json({
        items: await listPendingInvitations(deps.db, c.get("user").email, deps.clock.now()),
      } satisfies PendingInvitationList),
    )
    .get(
      "/:inviteId",
      validParam(InviteParamsSchema),
      validQuery(InviteLinkQuerySchema),
      async (c) => {
        const invite = await inviteFor(
          deps,
          c.req.valid("param").inviteId,
          c.get("user"),
          c.req.valid("query").token,
        );
        if (!invite) return c.json(NOT_FOUND, 404);
        if (invite.status !== "pending") return c.json(NOT_PENDING, 409);
        // Read it back through the invitee's view, which carries the workspace and inviter names.
        const pending = await listPendingInvitations(deps.db, invite.email, deps.clock.now());
        const found = pending.find((p) => p.id === invite.id);
        return found ? c.json(found) : c.json(NOT_PENDING, 409);
      },
    )
    .post(
      "/:inviteId/accept",
      validParam(InviteParamsSchema),
      validJson(InviteResponseInputSchema),
      async (c) => {
        const user = c.get("user");
        const invite = await inviteFor(
          deps,
          c.req.valid("param").inviteId,
          user,
          c.req.valid("json").token,
        );
        if (!invite) return c.json(NOT_FOUND, 404);
        const workspace = await acceptInvite(deps.db, invite.id, {
          userId: user.id,
          now: deps.clock.now(),
        });
        if (!workspace) return c.json(NOT_PENDING, 409);
        c.get("log").info("workspace.invite_accepted", {
          inviteId: invite.id,
          workspaceId: workspace.id,
          role: workspace.role,
        });
        await deps.live.publish(workspace.id, { type: "workspace.updated", data: {} });
        return c.json({ workspace } satisfies AcceptedInvite);
      },
    )
    .post(
      "/:inviteId/decline",
      validParam(InviteParamsSchema),
      validJson(InviteResponseInputSchema),
      async (c) => {
        const invite = await inviteFor(
          deps,
          c.req.valid("param").inviteId,
          c.get("user"),
          c.req.valid("json").token,
        );
        if (!invite) return c.json(NOT_FOUND, 404);
        if (!(await declineInvite(deps.db, invite.id, deps.clock.now())))
          return c.json(NOT_PENDING, 409);
        await deps.live.publish(invite.workspaceId, { type: "workspace.updated", data: {} });
        return c.body(null, 204);
      },
    );
}
