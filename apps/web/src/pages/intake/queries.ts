import { CurrentScanSchema, IntakeFormSchema, ProfileListSchema } from "@jobfilly/schema";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { queryKeys } from "../../hooks";
import { apiPaths } from "../../paths";

// The requests the intake form and the profile page share. Each key sits in the area its live
// event refetches (intake.updated: intake and profiles; scan.stopped: scan and intake).

export const intakeKey = (workspaceId: string) =>
  [...queryKeys.area(workspaceId, "intake"), "form"] as const;
export const profilesKey = (workspaceId: string) =>
  [...queryKeys.area(workspaceId, "profiles"), "list"] as const;

export const intakeApi = (workspaceId: string) => `${apiPaths.workspace(workspaceId)}/intake`;
export const profilesApi = (workspaceId: string) => `${apiPaths.workspace(workspaceId)}/profiles`;

/**
 * Whether the first scan has stopped, which opens the form. While the scan runs the form isn't
 * asked for, so nothing fails on the way.
 */
export function useFormOpen(workspaceId: string) {
  const scan = useQuery({
    queryKey: [...queryKeys.area(workspaceId, "scan"), "current"],
    queryFn: () => api(`${apiPaths.workspace(workspaceId)}/scans/current`, CurrentScanSchema),
  });
  const progress = scan.data?.progress;
  if (scan.isPending) return { pending: true, open: false } as const;
  // Without the scan's state, ask the form itself: it answers not_ready while the scan runs.
  if (scan.isError) return { pending: false, open: true } as const;
  const open = !!progress && !(progress.kind === "first" && progress.status !== "stopped");
  return { pending: false, open } as const;
}

export function useIntakeForm(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: intakeKey(workspaceId),
    queryFn: () => api(intakeApi(workspaceId), IntakeFormSchema),
    enabled,
    // The extra questions arrive with a live event; polling covers a dropped stream.
    refetchInterval: (query) => (query.state.data?.extras.status === "pending" ? 5000 : false),
  });
}

export function useProfiles(workspaceId: string) {
  return useQuery({
    queryKey: profilesKey(workspaceId),
    queryFn: async () => (await api(profilesApi(workspaceId), ProfileListSchema)).items,
  });
}
