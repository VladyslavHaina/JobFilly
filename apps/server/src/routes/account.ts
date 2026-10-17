import { accountDeletionPreview, deleteAccount, findUserByEmail } from "@jobfilly/db";
import { type AccountDeletionPreview, DeleteAccountInputSchema } from "@jobfilly/schema";
import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { type SignedInEnv, validJson } from "../access";
import { UNKNOWN_USER_HASH, verifyPassword } from "../auth/password";
import { requireUser, SESSION_COOKIE } from "../auth/session";
import type { AppDeps } from "../deps";

// Deleting one's account (MVP 3, F7.3), mounted at /api/account for the signed-in user: GET
// /deletion lists what goes (the workspaces they own, with their members) and what they just
// leave; DELETE / deletes it, confirmed with the account's password (D27). Works on the user's
// own view across workspaces (ARCHITECTURE › Workspaces, access and sessions).

/** Closes the live streams of members whose access to a workspace ended, on every replica. */
export async function endAccess(
  deps: AppDeps,
  ended: { workspaceId: string; userIds: string[] }[],
): Promise<void> {
  for (const { workspaceId, userIds } of ended) {
    for (const userId of userIds) {
      await deps.live.revoke({ type: "member.removed", workspaceId, userId });
    }
  }
}

export function accountRoutes(deps: AppDeps) {
  return new Hono<SignedInEnv>()
    .use(requireUser)
    .get("/deletion", async (c) =>
      c.json(
        (await accountDeletionPreview(deps.db, c.get("user").id)) satisfies AccountDeletionPreview,
      ),
    )
    .delete("/", validJson(DeleteAccountInputSchema), async (c) => {
      const user = c.get("user");
      const stored = await findUserByEmail(deps.db, user.email);
      const valid = await verifyPassword(
        c.req.valid("json").password,
        stored?.passwordHash ?? UNKNOWN_USER_HASH,
      );
      if (!stored || !valid) {
        return c.json({ error: "wrong_password", message: "That isn't your password" }, 403);
      }
      const deleted = await deleteAccount(deps.db, user, deps.clock.now());
      const log = c.get("log");
      for (const { workspaceId } of deleted.deletedWorkspaces) {
        log.info("workspace.deleted", { workspaceId });
      }
      log.info("account.deleted", {
        workspacesDeleted: deleted.deletedWorkspaces.length,
        workspacesLeft: deleted.leftWorkspaceIds.length,
      });
      await endAccess(deps, [
        ...deleted.deletedWorkspaces.map((w) => ({
          workspaceId: w.workspaceId,
          userIds: [user.id, ...w.memberIds],
        })),
        ...deleted.leftWorkspaceIds.map((workspaceId) => ({ workspaceId, userIds: [user.id] })),
      ]);
      for (const sessionId of deleted.sessionIds) {
        await deps.live.revoke({ type: "session.ended", sessionId });
      }
      for (const workspaceId of deleted.leftWorkspaceIds) {
        await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
      }
      deleteCookie(c, SESSION_COOKIE, { path: "/", secure: deps.config.secureCookies });
      return c.body(null, 204);
    });
}
