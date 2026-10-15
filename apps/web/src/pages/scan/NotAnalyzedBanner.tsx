import { Link } from "react-router";
import { ApiError } from "../../api";
import { Button } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { likelyJobEmails, useCurrentScan, useScanAction } from "./queries";

// Above the job inbox (F4.10): after a scan stopped with likely job mail unread, "N more likely
// job emails not analyzed" with Analyze them for admins; while a run is going, how far it is; and
// once an Analyze them run has stopped with nothing left, how it ended. The run fills in the job
// inbox only; the confirmed profile is never touched by it.

export function NotAnalyzedBanner({ workspaceId }: { workspaceId: string }) {
  const { can } = useWorkspace();
  const current = useCurrentScan(workspaceId);
  const action = useScanAction(workspaceId);
  const progress = current.data?.progress;
  if (!progress) return null;

  const frame = "mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-4 py-3";

  if (progress.status !== "stopped") {
    return (
      <div role="status" className={`${frame} border-indigo-200 bg-indigo-50 text-indigo-950`}>
        <p className="text-sm">
          {progress.kind === "first" ? "Scanning your mail" : "Analyzing the rest"}:{" "}
          {progress.analyzed} of {likelyJobEmails(progress.likely)} analyzed
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
    if (progress.kind !== "analyze_rest" || !current.data?.stopMessage) return null;
    return (
      <div role="status" className={`${frame} border-emerald-200 bg-emerald-50 text-emerald-900`}>
        <p className="text-sm">{current.data.stopMessage}</p>
      </div>
    );
  }

  const error =
    action.error instanceof ApiError
      ? action.error.message
      : action.error
        ? "That didn't work. Try again."
        : null;
  return (
    <div role="status" className={`${frame} border-amber-200 bg-amber-50 text-amber-950`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {progress.notAnalyzed} more likely job email{progress.notAnalyzed === 1 ? "" : "s"} not
          analyzed
        </p>
        {current.data?.stopMessage && (
          <p className="text-xs text-amber-900">{current.data.stopMessage}</p>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
      {can.admin && (
        <Button busy={action.isPending} onClick={() => action.mutate({ kind: "analyze_rest" })}>
          Analyze them
        </Button>
      )}
    </div>
  );
}
