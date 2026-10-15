import {
  type DecisionAnswer,
  DecisionCountSchema,
  type DecisionDismiss,
  DecisionListSchema,
  DecisionSchema,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api";
import { queryKeys } from "../../hooks";

// The decisions API (F7) for the inbox and the count in the navigation. Every query lives under
// the workspace's "decisions" area, so a decisions.updated event refetches them, live.

const decisionsPath = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/decisions`;

const area = (workspaceId: string) => queryKeys.area(workspaceId, "decisions");

export function useDecisions(workspaceId: string) {
  return useQuery({
    queryKey: [...area(workspaceId), "list"],
    queryFn: async () => (await api(decisionsPath(workspaceId), DecisionListSchema)).items,
  });
}

export function useDecisionCount(workspaceId: string) {
  return useQuery({
    queryKey: [...area(workspaceId), "count"],
    queryFn: async () =>
      (await api(`${decisionsPath(workspaceId)}/count`, DecisionCountSchema)).open,
  });
}

function useDecisionAction<V>(
  workspaceId: string,
  decisionId: string,
  action: string,
  body?: (v: V) => unknown,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) =>
      api(`${decisionsPath(workspaceId)}/${decisionId}/${action}`, DecisionSchema, {
        method: "POST",
        body: body?.(vars),
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: area(workspaceId) });
      // An answer changes the profile and brings drafts.
      void client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "profiles") });
      void client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "drafts") });
    },
  });
}

export const useAnswer = (workspaceId: string, decisionId: string) =>
  useDecisionAction(workspaceId, decisionId, "answer", (answer: DecisionAnswer) => answer);

export const useNotNow = (workspaceId: string, decisionId: string) =>
  useDecisionAction<void>(workspaceId, decisionId, "not-now");

export const useDismiss = (workspaceId: string, decisionId: string) =>
  useDecisionAction(workspaceId, decisionId, "dismiss", (role: DecisionDismiss) => role);

export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Try again.";
}
