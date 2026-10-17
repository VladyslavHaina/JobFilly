import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import type { Persona } from "../../fixtures/format.ts";
import { MARIA_RERUN_HINT } from "../../fixtures/format-mvp3.ts";
import {
  DIRECT_PORTS,
  errorsSince,
  type LogLine,
  logMark,
  logSince,
  openPage,
  PROXY_PORT,
  REPLICAS,
  ROOT,
  ready,
  seedInBackground,
  signIn,
  waitProxyRoutesTo,
  withCleanup,
  workspaceIdOf,
} from "../shared.ts";

// S10 of docs/mvp/MVP-3.md: a rolling restart under load (F10.1, F10.2), scripted. Maria and Tom
// each start a re-run of setup in their own workspace (the scan an admin can start once the
// first one is done) while `seed generate` brings new mail to both; then
// `node e2e/scripts/rolling-restart.ts` restarts app-a, app-b and app-c in turn, 10 seconds
// apart, polling both personas' sessions through the proxy all the while: it exits 0 only when
// no request failed and nobody was signed out (F10.2). The logs then show every scan stopped
// without failing, no batch ran twice, the syncs went on, and no error was logged (F10.1). The
// browsers saw no failed request either. Whatever happens, every replica is ready and routed
// again afterwards.

const RESTART_SCRIPT = join(ROOT, "e2e", "scripts", "rolling-restart.ts");
/** Generated mail during the run: a message a minute per persona is the soak's rate; more here. */
const GENERATE = ["generate", "--per-minute", "6", "--minutes", "3"];

const waitReady = (port: number) =>
  expect.poll(() => ready(port), { timeout: 180_000, intervals: [1_000] }).toBe(200);

/** Starts a re-run of setup from the profile page, as an admin does, and lands on the scan page. */
async function startRerun(page: Page, hint: string | null) {
  await openPage(page, "Profile");
  await page.getByRole("button", { name: "Re-run setup", exact: true }).click();
  if (hint) await page.getByLabel("What changed? (optional)", { exact: true }).fill(hint);
  await page.getByRole("button", { name: "Start the re-run", exact: true }).click();
  await expect(page).toHaveURL(/\/scan$/);
}

/** Every answer a page got with a status of 500 or more: a failed request, as a user sees it. */
function failedResponses(page: Page): string[] {
  const failed: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 500) failed.push(`${response.status()} ${response.url()}`);
  });
  return failed;
}

test("S10: rolling restart under load", async ({ page, browser, baseURL }) => {
  test.setTimeout(20 * 60_000);
  const mark = logMark();
  const tomContext = await browser.newContext({ baseURL });
  const tom = await tomContext.newPage();
  const pages: Record<Persona, Page> = { maria: page, tom };
  const failed = { maria: failedResponses(page), tom: failedResponses(tom) };

  try {
    const workspaces = {} as Record<Persona, string>;
    for (const persona of ["maria", "tom"] as const) {
      await signIn(pages[persona], persona);
      await expect(
        pages[persona].getByRole("heading", { name: "Job inbox", exact: true }),
      ).toBeVisible();
      workspaces[persona] = workspaceIdOf(pages[persona]);
    }
    expect(workspaces.maria).not.toBe(workspaces.tom);
    const of = (persona: Persona) => (l: LogLine) => l.workspaceId === workspaces[persona];

    await withCleanup(
      async () => {
        let generated: Promise<string> = Promise.resolve("");
        await test.step("new mail arrives; Maria and Tom each start a scan", async () => {
          generated = seedInBackground(GENERATE);
          await startRerun(page, MARIA_RERUN_HINT);
          await startRerun(tom, null);
          for (const persona of ["maria", "tom"] as const) {
            await expect
              .poll(
                () =>
                  logSince(mark).filter(
                    (l) => of(persona)(l) && l.event === "scan.started" && l.kind === "rerun",
                  ).length,
                { timeout: 60_000 },
              )
              .toBe(1);
          }
        });

        await test.step("the script restarts app-a, app-b and app-c in turn, 10 seconds apart", async () => {
          const run = await promisify(execFile)("node", [RESTART_SCRIPT], {
            cwd: ROOT,
            env: process.env,
            encoding: "utf8",
            maxBuffer: 1 << 26,
          }).catch((error: { code?: number; stdout?: string; stderr?: string }) => {
            throw new Error(
              `rolling-restart.ts exited ${error.code}:\n${error.stdout ?? ""}${error.stderr ?? ""}`,
            );
          });
          for (const replica of REPLICAS) expect(run.stdout).toContain(`restarting ${replica}`);
          expect(run.stdout).toMatch(/Requests through the proxy: [1-9]\d*, failed: 0/);
          expect(run.stdout).toContain("Signed out: nobody");
          await generated;
        });

        await test.step("F10.1: every scan completes, and no batch is processed twice", async () => {
          for (const persona of ["maria", "tom"] as const) {
            const lines = () => logSince(mark).filter(of(persona));
            const scanId = lines().find((l) => l.event === "scan.started")?.scanId;
            await expect
              .poll(
                () =>
                  lines().filter((l) => l.event === "scan.stopped" && l.scanId === scanId).length,
                { timeout: 5 * 60_000, intervals: [2_000] },
              )
              .toBe(1);
            const stopped = lines().find((l) => l.event === "scan.stopped" && l.scanId === scanId);
            expect(stopped?.reason, `${persona}'s scan`).not.toBe("failed");
            const batches = lines()
              .filter((l) => l.event === "scan.batch_completed" && l.scanId === scanId)
              .map((l) => l.batch);
            expect(new Set(batches).size, `${persona}'s batches`).toBe(batches.length);
            await pages[persona].reload();
            await expect(pages[persona].getByText(/^Stopped: (done|confident)/)).toBeVisible({
              timeout: 60_000,
            });
          }
        });

        await test.step("F10.1: the syncs go on and each draft is saved once; nobody is signed out", async () => {
          const afterRestarts = logMark();
          for (const persona of ["maria", "tom"] as const) {
            await expect
              .poll(
                () =>
                  logSince(afterRestarts).filter(
                    (l) => of(persona)(l) && l.event === "sync.completed",
                  ).length,
                { timeout: 120_000, intervals: [2_000] },
              )
              .toBeGreaterThan(0);
            const saved = logSince(mark)
              .filter((l) => of(persona)(l) && l.event === "draft.saved_to_mailbox")
              .map((l) => l.draftId);
            expect(new Set(saved).size, `${persona}'s drafts`).toBe(saved.length);
            // Still signed in, in their own workspace.
            await openPage(pages[persona], "Inbox");
            await expect(
              pages[persona].getByRole("heading", { name: "Job inbox", exact: true }),
            ).toBeVisible();
          }
          // Every replica served requests during the run.
          const served = new Set(
            logSince(mark)
              .filter((l) => l.event === "http.request")
              .map((l) => l.instance),
          );
          for (const replica of REPLICAS) expect(served, replica).toContain(replica);
        });

        await test.step("F10.2: the browsers saw no failed request; no error was logged", async () => {
          expect(failed).toEqual({ maria: [], tom: [] });
          expect(errorsSince(mark)).toEqual([]);
        });
      },
      async () => {
        for (const replica of REPLICAS) await waitReady(DIRECT_PORTS[replica]);
        await waitReady(PROXY_PORT);
        for (const replica of REPLICAS) await waitProxyRoutesTo(replica);
      },
    );
  } finally {
    await tomContext.close();
  }
});
