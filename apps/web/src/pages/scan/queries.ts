import { type CurrentScan, CurrentScanSchema } from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { queryKeys } from "../../hooks";
import { apiPaths } from "../../paths";

// The scan requests the scan page and the inbox banner share. The key sits in the "scan" area,
// which the app shell's live updates refetch on every scan.progress and scan.stopped event
// (F4.6); while a run is going, a slow poll covers a dropped stream until it reconnects.

const POLL_WHILE_RUNNING_MS = 5000;

const currentScanKey = (workspaceId: string) =>
  [...queryKeys.area(workspaceId, "scan"), "current"] as const;

const scansApi = (workspaceId: string) => `${apiPaths.workspace(workspaceId)}/scans`;

export function useCurrentScan(workspaceId: string) {
  return useQuery({
    queryKey: currentScanKey(workspaceId),
    queryFn: () => api(`${scansApi(workspaceId)}/current`, CurrentScanSchema),
    refetchInterval: (query) => {
      const status = query.state.data?.progress?.status;
      return status === "queued" || status === "running" ? POLL_WHILE_RUNNING_MS : false;
    },
  });
}

/** Start the first scan, cancel a run, or analyze the rest (admins); each answers CurrentScan. */
export function useScanAction(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      action: { kind: "start" } | { kind: "analyze_rest" } | { kind: "cancel"; scanId: string },
    ) => {
      const path =
        action.kind === "start"
          ? scansApi(workspaceId)
          : action.kind === "analyze_rest"
            ? `${scansApi(workspaceId)}/analyze-rest`
            : `${scansApi(workspaceId)}/${encodeURIComponent(action.scanId)}/cancel`;
      return api(path, CurrentScanSchema, { method: "POST", body: {} });
    },
    onSuccess: (current: CurrentScan) => {
      client.setQueryData(currentScanKey(workspaceId), current);
      void client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "scan") });
    },
  });
}

/** "1 likely job email", "26 likely job emails". */
export function likelyJobEmails(n: number): string {
  return `${n} likely job email${n === 1 ? "" : "s"}`;
}
