import { CvListSchema } from "@jobfilly/schema";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../../api";
import { queryKeys } from "../../hooks";
import { apiPaths } from "../../paths";

// The CVs of a workspace, under the "cvs" area so a cvs.updated event refetches them.

export const cvsKey = (workspaceId: string) =>
  [...queryKeys.area(workspaceId, "cvs"), "list"] as const;

export function useCvs(workspaceId: string) {
  return useQuery({
    queryKey: cvsKey(workspaceId),
    queryFn: async () => (await api(apiPaths.cvs(workspaceId), CvListSchema)).items,
  });
}

export const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : "That didn't work. Try again.";
