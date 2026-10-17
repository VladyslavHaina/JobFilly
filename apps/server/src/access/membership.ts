import { getMembership, getStoredMessages } from "@jobfilly/db";
import { IdSchema, JOB_CATEGORIES, type Role, roleAtLeast, scopeOf } from "@jobfilly/schema";
import type { MiddlewareHandler } from "hono";
import type { AppDeps } from "../deps";
import type { WorkspaceEnv } from "./env";

// Workspace access (F1.8, F1.9). Every route under /api/workspaces/:workspaceId/ passes
// workspaceMember, which answers 404 to anyone who isn't a member, exactly as for a workspace
// that doesn't exist. Each handler then calls requireRole for what it needs: 403 for a member
// without that role. Neither answer carries any data.

export const NOT_FOUND = { error: "not_found" } as const;
const FORBIDDEN = {
  error: "forbidden",
  message: "Your role in this workspace doesn't allow this",
} as const;

export function workspaceMember(deps: Pick<AppDeps, "db">): MiddlewareHandler<WorkspaceEnv> {
  return async (c, next) => {
    const user = c.get("user");
    const workspaceId = c.req.param("workspaceId");
    if (!user || !workspaceId || !IdSchema.safeParse(workspaceId).success)
      return c.json(NOT_FOUND, 404);
    const membership = await getMembership(deps.db, workspaceId, user.id);
    if (!membership) return c.json(NOT_FOUND, 404);
    c.set("workspaceId", workspaceId);
    c.set("membership", membership);
    c.set("log", c.get("log").child({ workspaceId }));
    await next();
  };
}

/**
 * 404, as for anything that doesn't exist, unless the member sees everything (MVP 3, F6.2): a
 * member who sees the job pipeline only gets no message bodies, drafts (nor sending) or non-job
 * mail. Mounted in front of whole route modules (app.ts) or used by a handler.
 */
export function requireFullAccess(): MiddlewareHandler<WorkspaceEnv> {
  return async (c, next) => {
    const membership = c.get("membership");
    if (!membership || scopeOf(membership) !== "everything") return c.json(NOT_FOUND, 404);
    await next();
  };
}

/**
 * For a member who sees the job pipeline only (MVP 3, F6.2): 404 for any route about one message
 * (the `messageId` path parameter) unless that message is job mail, reads and writes alike. app.ts
 * puts it in front of every /messages/:messageId and /senders/messages/:messageId route.
 */
export function requireJobMail(deps: Pick<AppDeps, "db">): MiddlewareHandler<WorkspaceEnv> {
  return async (c, next) => {
    const membership = c.get("membership");
    if (membership && scopeOf(membership) === "everything") return next();
    const messageId = c.req.param("messageId");
    const [message] = messageId
      ? await getStoredMessages(deps.db, c.get("workspaceId"), [messageId])
      : [];
    const job = (JOB_CATEGORIES as readonly (string | null)[]).includes(message?.category ?? null);
    if (!job) return c.json(NOT_FOUND, 404);
    await next();
  };
}

/** 403 unless the member's role includes `role` (viewer < editor < admin). */
export function requireRole(role: Role): MiddlewareHandler<WorkspaceEnv> {
  return async (c, next) => {
    const membership = c.get("membership");
    if (!membership || !roleAtLeast(membership.role, role)) return c.json(FORBIDDEN, 403);
    await next();
  };
}
