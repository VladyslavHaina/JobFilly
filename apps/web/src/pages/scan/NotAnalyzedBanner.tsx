import { Link } from "react-router";
import { Button } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { likelyJobEmails, scanActionError, useCurrentScan, useScanAction } from "./queries";
import { StopTime } from "./StopTime";

// Above the job inbox (F4.10): after a scan stopped with likely job mail unread, "N more likely
// job emails not analyzed" with Analyze them for admins and who can run it for everyone else;
// while a run is going, how far it is; and once a run has stopped, how it ended and when (the same
// words as the scan screen). The run fills in the job inbox only; the confirmed profile is never
// touched by it. The inbox's own "not included" note under a search points admins up here.

export function NotAnalyzedBanner({ workspaceId }: { workspaceId: string }) {
  const { can } = useWorkspace();
  const current = useCurrentScan(workspaceId);
  const action = useScanAction(workspaceId);
  const progress = current.data?.progress;
  if (!progress) return null;

  const frame = "mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-4 py-3";
  const stopMessage = current.data?.stopMessage ?? null;
  const stoppedAt = current.data?.stoppedAt ?? null;
  const failed = progress.stopReason === "failed";

  if (progress.status !== "stopped") {
    const what = progress.kind === "first" ? "Scanning your mail" : "Analyzing the rest";
    return (
      <div role="status" className={`${frame} border-indigo-200 bg-indigo-50 text-indigo-950`}>
        <p className="text-sm">
          {progress.status === "queued"
            ? `${progress.kind === "first" ? "Scan" : "Analyze them"} started…`
            : `${what}: ${progress.analyzed} of ${likelyJobEmails(progress.likely)} analyzed`}
        </p>
        <Link
          to={paths.scan(workspaceId)}
          className="text-sm font-medium text-indigo-700 hover:underline"
        >
          See progress
        </Link>
      </div>
    );
  }

  if (progress.notAnalyzed === 0) {
    if ((progress.kind !== "analyze_rest" && !failed) || !stopMessage) return null;
    const tone = failed
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";
    return (
      <div role="status" className={`${frame} ${tone}`}>
        <p className="text-sm">{stopMessage}</p>
        <p className="text-xs">
          <StopTime at={stoppedAt} />
        </p>
      </div>
    );
  }

  const error = scanActionError(action.error);
  return (
    <div role="status" className={`${frame} border-amber-200 bg-amber-50 text-amber-950`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {progress.notAnalyzed} more likely job email{progress.notAnalyzed === 1 ? "" : "s"} not
          analyzed
        </p>
        {stopMessage && (
          <p className={`text-xs ${failed ? "text-red-800" : "text-amber-900"}`}>
            {stopMessage} <StopTime at={stoppedAt} />
          </p>
        )}
        {!can.admin && (
          <p className="text-xs text-amber-900">An admin of this workspace can analyze them.</p>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
      {can.admin && (
        <Button busy={action.isPending} onClick={() => action.mutate({ kind: "analyze_rest" })}>
          {action.isPending ? "Starting…" : "Analyze them"}
        </Button>
      )}
    </div>
  );
}
