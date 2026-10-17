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
  | "mailbox"
  /** MVP 3: the application pipeline (F5) and sends waiting out their Undo (F4). */
  | "pipeline"
  | "sends"
  /** The workspace's model calls and tokens per day (F1.5): every event a model call can lead to. */
  | "usage";

export const queryKeys = {
  session: ["session"] as const,
  workspaces: ["workspaces"] as const,
  invitations: ["invitations"] as const,
  area: (workspaceId: string, area: LiveArea) => ["w", workspaceId, area] as const,
  /** GET /scans/current: the scan page and the inbox banner; live scan events update it. */
  currentScan: (workspaceId: string) => ["w", workspaceId, "scan", "current"] as const,
  members: (workspaceId: string) => ["w", workspaceId, "workspace", "members"] as const,
  invites: (workspaceId: string) => ["w", workspaceId, "workspace", "invites"] as const,
};
