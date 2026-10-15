import { getMembership } from "@jobfilly/db";
import { IdSchema, type Role, roleAtLeast } from "@jobfilly/schema";
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

/** 403 unless the member's role includes `role` (viewer < editor < admin). */
export function requireRole(role: Role): MiddlewareHandler<WorkspaceEnv> {
  return async (c, next) => {
    const membership = c.get("membership");
    if (!membership || !roleAtLeast(membership.role, role)) return c.json(FORBIDDEN, 403);
    await next();
  };
}
