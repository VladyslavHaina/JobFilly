// Query keys. Workspace data lives under ["w", workspaceId, area, ...]: a live event for an area
// refetches every query of that area (see useLiveInvalidation), so pages need no polling.

export type LiveArea =
  | "workspace"
  | "messages"
  | "intake"
  | "scan"
  | "profiles"
  | "cvs"
  | "drafts"
  | "decisions"
  | "assistant"
  | "mailbox";

export const queryKeys = {
  session: ["session"] as const,
  workspaces: ["workspaces"] as const,
  invitations: ["invitations"] as const,
  area: (workspaceId: string, area: LiveArea) => ["w", workspaceId, area] as const,
  members: (workspaceId: string) => ["w", workspaceId, "workspace", "members"] as const,
  invites: (workspaceId: string) => ["w", workspaceId, "workspace", "invites"] as const,
};
