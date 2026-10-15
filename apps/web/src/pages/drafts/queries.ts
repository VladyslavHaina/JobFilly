import {
  type Draft,
  type DraftListQuery,
  DraftListSchema,
  DraftSchema,
  type DraftStatus,
  type DraftUpdate,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { queryKeys } from "../../hooks";

// The drafts API (F6) for the Drafts page and the draft panel. Every query lives under the
// workspace's "drafts" area, so a drafts.updated event refetches them all.

const draftsPath = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/drafts`;

const draftsKey = (workspaceId: string, messageId?: string) =>
  [...queryKeys.area(workspaceId, "drafts"), "list", messageId ?? "all"] as const;

/** The query string of GET /drafts (DraftListQuerySchema), "" for every draft. */
function draftListQuery(query: DraftListQuery): string {
  const params = new URLSearchParams();
  if (query.messageId !== undefined) params.set("messageId", query.messageId);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The workspace's drafts, or one message's. */
export function useDrafts(workspaceId: string, messageId?: string) {
  return useQuery({
    queryKey: draftsKey(workspaceId, messageId),
    queryFn: async () =>
      (await api(`${draftsPath(workspaceId)}${draftListQuery({ messageId })}`, DraftListSchema))
        .items,
  });
}

function useDraftMutation<V>(workspaceId: string, request: (vars: V) => Promise<Draft>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "drafts") }),
  });
}

/** Saves an edit; the server replaces the mailbox copy (F6.4). */
export function useEditDraft(workspaceId: string, draftId: string) {
  return useDraftMutation(workspaceId, (edit: DraftUpdate) =>
    api(`${draftsPath(workspaceId)}/${draftId}`, DraftSchema, { method: "PATCH", body: edit }),
  );
}

/** Discards a draft; the server deletes it from the mailbox (F6.4). */
export function useDiscardDraft(workspaceId: string, draftId: string) {
  return useDraftMutation(workspaceId, () =>
    api(`${draftsPath(workspaceId)}/${draftId}/discard`, DraftSchema, { method: "POST" }),
  );
}

/** Draft a reply for one role, whatever its score (F6.5). */
export function useDraftReply(workspaceId: string) {
  return useDraftMutation(workspaceId, (role: { messageId: string; position: number }) =>
    api(draftsPath(workspaceId), DraftSchema, { method: "POST", body: role }),
  );
}

export const STATUS_LABELS: Record<DraftStatus, string> = {
  saving: "Saving to your mailbox…",
  in_mailbox: "In mailbox",
  edited: "Edited",
  discarded: "Discarded",
  failed: "Failed",
};
