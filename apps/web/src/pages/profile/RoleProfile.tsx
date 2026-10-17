import type { RoleProfile as RoleProfileValue } from "@jobfilly/schema";

// The profile a role belongs to, with why, and an editor's reassign (MVP 3, F1.3), shown on
// every role of the message detail. Built by the profiles slice; the foundation mounted it.

export function RoleProfile(_props: {
  workspaceId: string;
  messageId: string;
  position: number;
  profile: RoleProfileValue | null;
}) {
  return null;
}
