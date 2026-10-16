import { expect, test } from "@playwright/test";
import {
  compose,
  DIRECT_PORTS,
  logged,
  PROXY_PORT,
  type Replica,
  ready,
  replicaNamed,
  signIn,
  withCleanup,
  workspaceIdOf,
} from "../shared.ts";

// S9 of docs/mvp/MVP-1.md: a replica dies mid-run (F4.8, F4.10, F1.3). The infrastructure step
// is the scenario's own: `docker compose -p <project> -f docker/compose.e2e.yaml kill` of the
// replica running Analyze them, read from the log; then `start` to bring it back. Whatever
// happens, the cleanup starts it again, so the specs after this one have both replicas.

/** F4.8: the other replica takes the run over within this long of the kill. */
const TAKEOVER_MS = 60_000;

const waitReady = (port: number) =>
  expect.poll(() => ready(port), { timeout: 120_000, intervals: [1_000] }).toBe(200);

test("S9: a replica dies mid-run", async ({ page }) => {
  test.setTimeout(15 * 60_000);

  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  const earlier = new Set(logged("scan.started", { workspaceId }).map((l) => l.scanId));

  let scanId: unknown;
  let killed: Replica | undefined;
  await withCleanup(
    async () => {
      await test.step("Maria presses Analyze them; the replica running it is killed", async () => {
        await page.getByRole("button", { name: "Analyze them", exact: true }).click();
        await expect(page.getByText(/^(Analyze them started…|Analyzing the rest: )/)).toBeVisible();
        const started = () =>
          logged("scan.started", { workspaceId }).filter((l) => !earlier.has(l.scanId));
        await expect.poll(started, { timeout: 60_000 }).toHaveLength(1);
        const [run] = started();
        scanId = run?.scanId;
        // The latest replica to run it: scan.started, or a scan.resumed after it.
        const resumed = logged("scan.resumed", { scanId });
        const instance = (resumed.at(-1) ?? run)?.instance;
        killed = replicaNamed(instance);
        expect(killed, `the scan runs on a replica: ${instance}`).toBeDefined();
        // Still running: the run must be cut off mid-way.
        await expect(page.getByText(/^(Analyze them started…|Analyzing the rest: )/)).toBeVisible();
        compose(["kill", String(killed)]);
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
        compose(["start", String(killed)]);
        await waitReady(DIRECT_PORTS[killed ?? "app-a"]);
        await page.reload();
        await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
        // F1.3: page loads spread over both replicas never ask to sign in again.
        for (let i = 0; i < 20; i++) {
          await page.reload();
          await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
          await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toHaveCount(0);
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
    },
    async () => {
      if (!killed) return;
      compose(["start", killed]);
      await waitReady(DIRECT_PORTS[killed]);
      await waitReady(PROXY_PORT);
    },
  );
});
