import type { Impact } from "@jobfilly/schema";
import { ApiError } from "../../api";
import { queryKeys } from "../../hooks";
import { apiPaths } from "../../paths";

// The assistant's requests and query keys. The thread lives in the "assistant" area and the
// profile history in the "profiles" area, so assistant.updated and profiles.updated refetch them
// wherever they are open.

export const assistantKey = (workspaceId: string) =>
  [...queryKeys.area(workspaceId, "assistant"), "thread"] as const;

export const historyKey = (workspaceId: string, profileId: string) =>
  [...queryKeys.area(workspaceId, "profiles"), "history", profileId] as const;

export const assistantApi = (workspaceId: string) => `${apiPaths.workspace(workspaceId)}/assistant`;

export const proposalApi = (workspaceId: string, proposalId: string, action?: string) =>
  `${assistantApi(workspaceId)}/proposals/${encodeURIComponent(proposalId)}${action ? `/${action}` : ""}`;

export const historyApi = (workspaceId: string, profileId: string) =>
  `${apiPaths.workspace(workspaceId)}/profiles/${encodeURIComponent(profileId)}/history`;

export const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : "Something went wrong. Try again.";

const roles = (n: number) => `${n} ${n === 1 ? "role" : "roles"}`;

/**
 * A proposal's impact in plain words (F8.2, F8.5): "hides 3 roles; 1 draft is already in your
 * mailbox and stays there".
 */
export function impactWords(impact: Impact): string {
  const parts: string[] = [];
  if (impact.hides > 0) parts.push(`hides ${roles(impact.hides)}`);
  if (impact.shows > 0) parts.push(`shows ${roles(impact.shows)} again`);
  if (impact.scoreMoves > 0) parts.push(`changes the fit score of ${roles(impact.scoreMoves)}`);
  if (impact.draftsNotCreated > 0) {
    const n = impact.draftsNotCreated;
    parts.push(`${n} ${n === 1 ? "draft won't be" : "drafts won't be"} created`);
  }
  if (parts.length === 0) parts.push("changes none of your current roles");
  if (impact.draftsInMailbox > 0) {
    const n = impact.draftsInMailbox;
    parts.push(
      n === 1
        ? "1 draft is already in your mailbox and stays there"
        : `${n} drafts are already in your mailbox and stay there`,
    );
  }
  return parts.join("; ");
}
