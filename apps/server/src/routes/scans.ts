import { stopMessage } from "@jobfilly/core";
import {
  countNotAnalyzed,
  createScan,
  getAiSettings,
  getLatestScan,
  getMailboxConnection,
  getScan,
  stopScan,
  updateScanProgress,
  usageTotal,
} from "@jobfilly/db";
import {
  type CurrentScan,
  type Scan,
  type ScanKind,
  ScanParamsSchema,
  type ScanProgress,
} from "@jobfilly/schema";
import { type Context, Hono } from "hono";
import { NOT_FOUND, requireRole, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";

// Scan runs (F4): the current run's progress for everyone in the workspace, and for admins
// starting the first scan, cancelling a run and "Analyze them" (F4.10). Starting only queues the
// 'scan.run' job together with the scan row; whichever replica claims the job runs it
// (jobs/scan), and progress reaches every browser over SSE.

const RUNNING = { error: "running", message: "A scan is already running" } as const;
const NO_MAILBOX = { error: "no_mailbox", message: "Connect a mailbox before starting a scan" };
const NO_AI = { error: "no_ai", message: "Pick an AI provider before starting a scan" };
const NO_FIRST_SCAN = {
  error: "no_first_scan",
  message: "The first scan has to finish before the rest can be analyzed",
};
const STOPPED = { error: "stopped", message: "This scan has already stopped" };

function progressOf(scan: Scan): ScanProgress {
  return {
    ...scan.counts,
    scanId: scan.id,
    kind: scan.kind,
    status: scan.status,
    stopReason: scan.stopReason,
    calls: scan.calls,
    tokens: scan.inputTokens + scan.outputTokens,
  };
}

function messageOf(scan: Scan): string | null {
  if (scan.status !== "stopped" || !scan.stopReason) return null;
  return stopMessage(scan.stopReason, scan.counts.analyzed, scan.counts.likely);
}

async function current(deps: AppDeps, workspaceId: string, scan: Scan | null) {
  const usage = await usageTotal(deps.db, workspaceId);
  return {
    progress: scan ? progressOf(scan) : null,
    stopMessage: scan ? messageOf(scan) : null,
    totalTokens: usage.inputTokens + usage.outputTokens,
  } satisfies CurrentScan;
}

export function scanRoutes(deps: AppDeps) {
  /** Queues a run of `kind` with its job, once the mailbox and the AI are set up. */
  async function start(c: Context<WorkspaceEnv>, kind: ScanKind) {
    const workspaceId = c.get("workspaceId");
    if (!(await getMailboxConnection(deps.db, workspaceId))) return c.json(NO_MAILBOX, 409);
    if (!(await getAiSettings(deps.db, workspaceId))) return c.json(NO_AI, 409);
    const created = await createScan(deps.db, workspaceId, {
      kind,
      startedBy: c.get("user").id,
      at: deps.clock.now(),
      enqueue: true,
    });
    if (!created.ok) return c.json(RUNNING, 409);
    await deps.live.publish(workspaceId, {
      type: "scan.progress",
      data: progressOf(created.scan),
    });
    return c.json(await current(deps, workspaceId, created.scan), 201);
  }

  return new Hono<WorkspaceEnv>()
    .get("/current", requireRole("viewer"), async (c) => {
      const workspaceId = c.get("workspaceId");
      return c.json(await current(deps, workspaceId, await getLatestScan(deps.db, workspaceId)));
    })
    .post("/", requireRole("admin"), (c) => start(c, "first"))
    .post("/:scanId/cancel", requireRole("admin"), validParam(ScanParamsSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const scan = await getScan(deps.db, workspaceId, c.req.valid("param").scanId);
      if (!scan) return c.json(NOT_FOUND, 404);
      if (scan.status === "stopped") return c.json(STOPPED, 409);
      // The banner's count must be right after the stop, which nothing may update any more.
      const counts = { ...scan.counts, notAnalyzed: await countNotAnalyzed(deps.db, workspaceId) };
      await updateScanProgress(deps.db, workspaceId, scan.id, {
        status: scan.status,
        counts,
        calls: scan.calls,
        inputTokens: scan.inputTokens,
        outputTokens: scan.outputTokens,
      });
      if (!(await stopScan(deps.db, workspaceId, scan.id, "cancelled", deps.clock.now()))) {
        return c.json(STOPPED, 409);
      }
      c.get("log").info("scan.stopped", { scanId: scan.id, reason: "cancelled" });
      const stopped = (await getScan(deps.db, workspaceId, scan.id)) as Scan;
      await deps.live.publish(workspaceId, {
        type: "scan.stopped",
        data: { ...progressOf(stopped), stopMessage: messageOf(stopped) ?? "" },
      });
      return c.json(await current(deps, workspaceId, stopped));
    })
    .post("/analyze-rest", requireRole("admin"), async (c) => {
      const first = await getLatestScan(deps.db, c.get("workspaceId"), "first");
      if (!first) return c.json(NO_FIRST_SCAN, 409);
      if (first.status !== "stopped") return c.json(RUNNING, 409);
      return start(c, "analyze_rest");
    });
}
