import { type CurrentScan, CurrentScanSchema, type StartScanInput } from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api";
import { queryKeys } from "../../hooks";
import { apiPaths } from "../../paths";

// The scan requests the scan page and the inbox banner share. The key sits in the "scan" area:
// the app shell's live updates show each scan.progress and scan.stopped event's counts at once
// and refetch it (F4.6); while a run is going, a slow poll covers a dropped stream until it
// reconnects.

const POLL_WHILE_RUNNING_MS = 5000;

const currentScanKey = queryKeys.currentScan;

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

/** What an admin can do with scans: each answers CurrentScan. */
type ScanAction =
  | { kind: "start" }
  | { kind: "analyze_rest" }
  | { kind: "cancel"; scanId: string }
  /** MVP 3 (F1.1): re-run setup, with an optional hint. */
  | { kind: "rerun"; hint: string };

/** Start the first scan, cancel a run, analyze the rest or re-run setup (admins). */
export function useScanAction(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: ScanAction) => {
      if (action.kind === "rerun") {
        const body: StartScanInput = { kind: "rerun", hint: action.hint.trim() || undefined };
        return api(scansApi(workspaceId), CurrentScanSchema, { method: "POST", body });
      }
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

/** What a failed scan action says: the server's plain reason, or else a generic retry. */
export function scanActionError(error: unknown): string | null {
  if (error instanceof ApiError) return error.message;
  return error ? "That didn't work. Try again." : null;
}

/** "1 likely job email", "26 likely job emails". */
export function likelyJobEmails(n: number): string {
  return `${n} likely job email${n === 1 ? "" : "s"}`;
}
