import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PERSONA_ADDRESSES } from "../../fixtures/format.ts";
import { COMPOSE_FILE, fileState } from "../../stack.ts";

// S9 of docs/mvp/MVP-1.md: a replica dies mid-run (F4.8, F4.10, F1.3). The infrastructure step
// is the scenario's own: `docker compose -p <project> -f docker/compose.e2e.yaml kill` of the
// replica running Analyze them, read from the log; then `start` to bring it back.

const LOGIN = "E2E-SECRET-maria-login";
/** Each replica's direct port on the test stack's proxy. */
const DIRECT_PORTS: Record<string, number> = { "app-a": 8081, "app-b": 8082 };
/** F4.8: the other replica takes the run over within this long of the kill. */
const TAKEOVER_MS = 60_000;

const ROOT = resolve(import.meta.dirname, "../../..");
/** The running stack's compose project: the one stack.ts passes on, else e2e/.stack's. */
const project = process.env.JOBFILLY_E2E_PROJECT ?? fileState(join(ROOT, "e2e", ".stack")).read();
const REPLICAS = ["app-a", "app-b"];
type LogLine = { event?: unknown; instance?: unknown; time?: unknown; [field: string]: unknown };

function compose(args: string[]): string {
  if (!project) throw new Error('No test stack is up: start one with "pnpm e2e:stack up"');
  return execFileSync("docker", ["compose", "-p", project, "-f", COMPOSE_FILE, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
}

function replicaLog(replica: string): LogLine[] {
  return compose(["logs", "--no-color", "--no-log-prefix", replica])
    .split("\n")
    .flatMap((line) => {
      try {
        return line.startsWith("{") ? [JSON.parse(line) as LogLine] : [];
      } catch {
        return [];
      }
    });
}

/** Every line both replicas logged with this event and these fields. */
const logged = (event: string, fields: Record<string, unknown>) =>
  REPLICAS.flatMap(replicaLog).filter(
    (l) => l.event === event && Object.entries(fields).every(([k, v]) => l[k] === v),
  );

async function ready(port: number): Promise<number | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
    return response.status;
  } catch {
    return null;
  }
}

test("S9: a replica dies mid-run", async ({ page }) => {
  test.setTimeout(15 * 60_000);

  await page.goto("/");
  await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
  await page.getByLabel("Password").fill(LOGIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Job inbox" })).toBeVisible();
  const workspaceId = new URL(page.url()).pathname.split("/")[2] ?? "";
  const earlier = new Set(logged("scan.started", { workspaceId }).map((l) => l.scanId));

  let scanId: unknown;
  let killed = "";
  await test.step("Maria presses Analyze them; the replica running it is killed", async () => {
    await page.getByRole("button", { name: "Analyze them" }).click();
    await expect(page.getByText(/^(Analyze them started…|Analyzing the rest: )/)).toBeVisible();
    await expect
      .poll(() => logged("scan.started", { workspaceId }).filter((l) => !earlier.has(l.scanId)), {
        timeout: 60_000,
      })
      .toHaveLength(1);
    const [started] = logged("scan.started", { workspaceId }).filter((l) => !earlier.has(l.scanId));
    scanId = started?.scanId;
    // The latest replica to run it: scan.started, or a scan.resumed after it.
    const resumed = logged("scan.resumed", { scanId });
    killed = String((resumed.at(-1) ?? started)?.instance);
    expect(REPLICAS).toContain(killed);
    // Still running: the run must be cut off mid-way.
    await expect(page.getByText(/^(Analyze them started…|Analyzing the rest: )/)).toBeVisible();
    compose(["kill", killed]);
  });

  await test.step("the other replica takes the run over and completes it", async () => {
    await expect
      .poll(() => logged("scan.resumed", { scanId, previousInstance: killed }).length, {
        timeout: TAKEOVER_MS,
        intervals: [2_000],
      })
      .toBe(1);
    await expect(
      page.getByText(/^Stopped: done, all \d+ likely job emails? analyzed$/),
    ).toBeVisible({
      timeout: 10 * 60_000,
    });
    await expect(page.getByText(/more likely job emails? not analyzed$/)).toHaveCount(0);
  });

  await test.step("the killed replica starts again, and Maria is still signed in", async () => {
    compose(["start", killed]);
    await expect
      .poll(() => ready(DIRECT_PORTS[killed] ?? 0), { timeout: 120_000, intervals: [1_000] })
      .toBe(200);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Job inbox" })).toBeVisible();
    // F1.3: page loads spread over both replicas never ask to sign in again.
    for (let i = 0; i < 20; i++) {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Job inbox" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
    }
  });

  await test.step("logs: the lease expired, the run resumed, no batch ran twice", async () => {
    // The scan run's lease (other jobs of the workspace the killed replica held expire too).
    const expired = { workspaceId, previousInstance: killed, jobType: "scan.run" };
    expect(logged("job.lease_expired", expired)).toHaveLength(1);
    const batches = logged("scan.batch_completed", { scanId }).map((l) => l.batch);
    expect(batches.length).toBeGreaterThan(0);
    expect(new Set(batches).size).toBe(batches.length);
    expect(logged("scan.stopped", { scanId, reason: "done" })).toHaveLength(1);
  });
});
