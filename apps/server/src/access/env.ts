import type { User, WorkspaceSummary } from "@jobfilly/schema";
import type { Logger } from "../log";

// The Hono environments: what middleware puts on the request context for the handlers.

interface RequestVariables {
  requestId: string;
  /** A logger carrying this request's requestId (and userId/workspaceId once known). */
  log: Logger;
  /** Set by the session middleware when the cookie names a live session. */
  user: User | undefined;
  sessionId: string | undefined;
}

export type AppEnv = { Variables: RequestVariables };

export type SignedInEnv = {
  Variables: RequestVariables & { user: User; sessionId: string };
};

/** Routes under /api/workspaces/:workspaceId/*, after workspaceMember. */
export type WorkspaceEnv = {
  Variables: SignedInEnv["Variables"] & { workspaceId: string; membership: WorkspaceSummary };
};
