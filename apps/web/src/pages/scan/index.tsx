import { SCAN_WINDOW_DAYS, type ScanProgress } from "@jobfilly/schema";
import { Link } from "react-router";
import { Alert, Button, Card, Loading, PageHeader } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { likelyJobEmails, scanActionError, useCurrentScan, useScanAction } from "./queries";
import { StopTime } from "./StopTime";

// The scan screen (F4): start the first scan, watch its counts change live in every open browser
// of the workspace (F4.6), and read why it stopped (F4.4). Admins start, cancel and analyze the
// rest; everyone else watches.

const number = new Intl.NumberFormat("en");

function Stat(props: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5">
      <dt className="text-xs font-medium text-stone-600">{props.label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-stone-900">
        {number.format(props.value)}
      </dd>
      {props.hint && <p className="text-xs text-stone-500">{props.hint}</p>}
    </div>
  );
}

function Counts({ progress, totalTokens }: { progress: ScanProgress; totalTokens: number }) {
  const share = progress.likely === 0 ? 0 : Math.round((progress.analyzed / progress.likely) * 100);
  return (
    <>
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-sm text-stone-700">
          <span>
            Analyzed {number.format(progress.analyzed)} of {likelyJobEmails(progress.likely)}
          </span>
          <span className="tabular-nums">{share}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Likely job emails analyzed"
          aria-valuemin={0}
          aria-valuemax={progress.likely}
          aria-valuenow={progress.analyzed}
          className="h-2 overflow-hidden rounded-full bg-stone-200"
        >
          <div className="h-full bg-indigo-600 transition-all" style={{ width: `${share}%` }} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Handled without AI"
          value={progress.handledWithoutAi}
          hint="sorted from the headers"
        />
        <Stat label="Likely job emails" value={progress.likely} />
        <Stat label="Analyzed" value={progress.analyzed} />
        <Stat label="Job emails found" value={progress.jobFound} />
        <Stat label="Answers firming up" value={progress.answersFirm} hint="medium or high" />
        <Stat label="Not analyzed yet" value={progress.notAnalyzed} />
        <Stat label="AI calls this run" value={progress.calls} />
        <Stat
          label="Tokens used in total"
          value={totalTokens}
          hint="every AI call in this workspace"
        />
      </dl>
    </>
  );
}

function Status({
  progress,
  stopMessage,
  stoppedAt,
}: {
  progress: ScanProgress;
  stopMessage: string | null;
  stoppedAt: string | null;
}) {
  if (progress.status === "queued") {
    return (
      <Loading label={progress.kind === "first" ? "Starting the scan…" : "Analyze them started…"} />
    );
  }
  if (progress.status === "running") {
    return (
      <Loading
        label={
          progress.kind === "first"
            ? `Scanning the last ${SCAN_WINDOW_DAYS} days of your Inbox and Sent mail…`
            : "Analyzing the rest of your likely job emails…"
        }
      />
    );
  }
  const tone =
    progress.stopReason === "failed"
      ? "error"
      : progress.stopReason === "budget" || progress.stopReason === "cancelled"
        ? "warning"
        : "success";
  return (
    <Alert tone={tone} title={stopMessage ?? "Stopped"}>
      {stoppedAt && <StopTime at={stoppedAt} />}
    </Alert>
  );
}

export function ScanPage({ workspaceId }: { workspaceId: string }) {
  const { can } = useWorkspace();
  const current = useCurrentScan(workspaceId);
  const action = useScanAction(workspaceId);
  const error = scanActionError(action.error);

  if (current.isPending) return <Loading />;
  if (current.isError) return <Alert>Couldn't load the scan. Reload the page to try again.</Alert>;

  const { progress, stopMessage, stoppedAt, totalTokens } = current.data;
  const active = progress?.status === "queued" || progress?.status === "running";
  const stopped = progress?.status === "stopped";
  // The first scan may be started again only when it never got anywhere.
  const canStart =
    !progress ||
    (stopped &&
      progress.kind === "first" &&
      (progress.stopReason === "failed" || progress.stopReason === "cancelled"));

  return (
    <section>
      <PageHeader
        title="Scan"
        description={`The first scan reads the last ${SCAN_WINDOW_DAYS} days of your Inbox and Sent mail, sorts out what is plainly not job mail without AI, and lets the AI read the rest, newest first, until it is confident.`}
      />
      <Card className="flex flex-col gap-5">
        {progress ? (
          <>
            <Status progress={progress} stopMessage={stopMessage} stoppedAt={stoppedAt} />
            <Counts progress={progress} totalTokens={totalTokens} />
          </>
        ) : (
          <p className="text-sm text-stone-700">
            No scan yet.{" "}
            {can.admin
              ? "Start it once your mailbox and AI are set up."
              : "An admin of this workspace can start it."}
          </p>
        )}
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          {can.admin && canStart && (
            <Button busy={action.isPending} onClick={() => action.mutate({ kind: "start" })}>
              {progress ? "Start scan again" : "Start scan"}
            </Button>
          )}
          {can.admin && active && progress && (
            <Button
              variant="secondary"
              busy={action.isPending}
              onClick={() => action.mutate({ kind: "cancel", scanId: progress.scanId })}
            >
              Cancel scan
            </Button>
          )}
          {can.admin && stopped && !canStart && progress.notAnalyzed > 0 && (
            <Button
              variant="secondary"
              busy={action.isPending}
              onClick={() => action.mutate({ kind: "analyze_rest" })}
            >
              {action.isPending ? "Starting…" : "Analyze them"}
            </Button>
          )}
          {stopped && progress.kind === "first" && !canStart && (
            <Link
              to={paths.intake(workspaceId)}
              className="text-sm font-medium text-indigo-700 hover:underline"
            >
              Review your answers
            </Link>
          )}
          {stopped && (
            <Link
              to={paths.inbox(workspaceId)}
              className="text-sm font-medium text-indigo-700 hover:underline"
            >
              Open the job inbox
            </Link>
          )}
        </div>
      </Card>
    </section>
  );
}
