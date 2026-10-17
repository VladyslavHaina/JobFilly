import { PipelineItemSchema, PipelineSchema, type SetStageInput } from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { queryKeys } from "../../hooks";
import { apiPaths } from "../../paths";

// The pipeline API (F5). The stages come from the mail, so the query lives under the "messages"
// area: new mail, a draft or a send refetches it, live (messages.updated, drafts.updated and
// sends.updated all touch that area). A stage set here refetches it at once.

const pipelinePath = (workspaceId: string) => `${apiPaths.workspace(workspaceId)}/pipeline`;

const pipelineKey = (workspaceId: string) => [
  ...queryKeys.area(workspaceId, "messages"),
  "pipeline",
];

export function usePipeline(workspaceId: string) {
  return useQuery({
    queryKey: pipelineKey(workspaceId),
    queryFn: () => api(pipelinePath(workspaceId), PipelineSchema),
  });
}

/** Sets a role's stage by hand, or with null goes back to the one its mail gives. */
export function useSetStage(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SetStageInput) =>
      api(`${pipelinePath(workspaceId)}/stage`, PipelineItemSchema, { method: "PUT", body: input }),
    onSettled: () => client.invalidateQueries({ queryKey: pipelineKey(workspaceId) }),
  });
}
