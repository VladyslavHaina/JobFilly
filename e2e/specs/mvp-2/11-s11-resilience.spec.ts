import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import {
  type EnvelopeEntry,
  fixturesDir,
  MARIA_KEY_MESSAGES,
  personaPaths,
  readJson,
} from "../../fixtures/format.ts";
import {
  compose,
  DIRECT_PORTS,
  delivery,
  errorsSince,
  followLogs,
  inboxRow,
  inspectDrafts,
  type LogLine,
  logged,
  logMark,
  logSince,
  openMessage,
  openPage,
  PROXY_PORT,
  REPLICAS,
  type Replica,
  ready,
  replicaNamed,
  seed,
  seedInBackground,
  signIn,
  withCleanup,
  workspaceIdOf,
} from "../shared.ts";

// S11 of docs/mvp/MVP-2.md: resilience (F1.2–F1.4), the last scenario on the stack. The
// infrastructure steps are the scenario's own: `seed deliver s11-failover`, then the replica that
// logs the next sync.started of Maria's mailbox is killed while that sync runs (the sync reads
// the new message and runs the model on it inline, so it lasts about a second; the log is
// followed as it is written and the container killed directly, so the kill lands in it). The
// other replica takes the sync over once the lease expires. Then `docker compose pause imap`,
// `unpause imap` and `seed deliver s11-recovery`, and `seed reset-uidvalidity maria`. Both
// deliveries are capped onsite roles (TBD-442): no draft, no decision. Whatever happens, the
// cleanup unpauses imap and starts the killed replica again.

const FAILOVER = delivery("s11-failover");
const RECOVERY = delivery("s11-recovery");
const FREEMAIL = delivery("freemail");

const envelopes = readJson<EnvelopeEntry[]>(`${fixturesDir()}${personaPaths("maria").envelopes}`);
const correctedSubject =
  envelopes.find((e) => e.messageId === MARIA_KEY_MESSAGES.alwaysInvalid)?.subject ?? "";

const SYNC_EVENTS = ["sync.started", "sync.completed", "sync.failed"];
const CANT_REACH = /^Can't reach the mail server since \d{2}:\d{2}$/;

/**
 * How early a retry may start: a back-off ending within half a sync interval (15 s in the test
 * stack) counts as due (isDue in apps/server/src/sync/run.ts), plus a second for the tick.
 */
const EARLY_RETRY_MS = 7_500 + 1_000;

const waitReady = (port: number) =>
  expect.poll(() => ready(port), { timeout: 120_000, intervals: [1_000] }).toBe(200);

const search = (page: Page) => page.getByLabel("Search sender or subject");

/** A row of the inbox found by searching for it, as it comes in. */
async function expectArrived(page: Page, subject: string, timeout: number) {
  await openPage(page, "Inbox");
  await search(page).fill(subject);
  await expect(inboxRow(page, subject)).toBeVisible({ timeout });
}

/** What the re-index must keep (F1.3), as Maria sees it, and the mailbox's Drafts folder. */
async function snapshot(page: Page) {
  await openPage(page, "Drafts");
  await expect(page.getByRole("heading", { name: "Drafts", level: 1, exact: true })).toBeVisible();
  const statuses = page.getByRole("img", { name: /^Draft status: / });
  await expect(statuses.first()).toBeVisible();
  const drafts = (
    await statuses.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
  ).sort();

  await openPage(page, "Decisions");
  await expect(
    page.getByRole("heading", { name: "Decisions", level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/^Nothing to decide\.|messages? (is|are) waiting on this:$/).first(),
  ).toBeVisible();
  const decisions = await page.getByRole("article").allInnerTexts();

  await openPage(page, "Inbox");
  await openMessage(page, correctedSubject);
  const category = page.getByLabel("Category", { exact: true });
  await expect(category).toHaveValue("other_job");
  await expect(page.getByText("Corrected by hand: later analysis keeps it.")).toBeVisible();

  await openMessage(page, FREEMAIL.subject);
  const trusted = page
    .getByRole("region", { name: "Sender check", exact: true })
    .getByRole("button", { name: "Trusted", exact: true });
  await expect(trusted).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  const mailbox = inspectDrafts("maria")
    .drafts.map((d) => d.inReplyTo)
    .sort();
  return { drafts, decisions, mailbox };
}

test("S11: resilience", async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  const mine = (l: LogLine) => l.workspaceId === workspaceId;

  let killed: Replica | undefined;
  let imapPaused = false;
  await withCleanup(
    async () => {
      await test.step("deliver one message; kill the replica that runs the next sync", async () => {
        // Killed by container id, which is quicker than through compose.
        const containers = Object.fromEntries(
          REPLICAS.map((r) => [r, compose(["ps", "--quiet", r]).trim()]),
        ) as Record<Replica, string>;
        const kill = (line: LogLine) => {
          killed = replicaNamed(line.instance);
          if (killed) execFileSync("docker", ["kill", containers[killed]]);
        };
        const follow = followLogs();
        try {
          // The follower is attached once it has a line: replicas log every sync interval.
          await follow.next(() => true, 60_000);
          await seedInBackground(["deliver", FAILOVER.id]);
          const delivered = follow.lines.length;
          // The sync of her mailbox running now, or else the next one to start: it reads the
          // message. The kill starts as its line arrives.
          const last = follow.lines
            .filter((l) => mine(l) && SYNC_EVENTS.includes(String(l.event)))
            .at(-1);
          if (last?.event === "sync.started") {
            kill(last);
          } else {
            await follow.next(
              (l) => {
                if (!mine(l) || l.event !== "sync.started") return false;
                kill(l);
                return true;
              },
              60_000,
              delivered,
            );
          }
          expect(killed, "the sync ran on a replica").toBeDefined();
        } finally {
          follow.stop();
        }
      });

      await test.step("the other replica takes the sync over once the lease expires", async () => {
        const afterKill = logMark();
        const other = REPLICAS.find((r) => r !== killed);
        await expect
          .poll(
            () =>
              logSince(afterKill).filter(
                (l) =>
                  mine(l) &&
                  l.event === "job.lease_expired" &&
                  l.jobType === "mail.sync" &&
                  l.previousInstance === killed &&
                  l.instance === other,
              ).length,
            { timeout: 120_000, intervals: [2_000] },
          )
          .toBeGreaterThan(0);
        const syncs = () =>
          logSince(afterKill).filter((l) => mine(l) && SYNC_EVENTS.includes(String(l.event)));
        await expect
          .poll(() => syncs().filter((l) => l.event === "sync.completed").length, {
            timeout: 120_000,
            intervals: [2_000],
          })
          .toBeGreaterThan(0);
        expect(syncs().map((l) => l.instance)).toEqual(syncs().map(() => other));
      });

      await test.step("the message arrives", async () => {
        await expectArrived(page, FAILOVER.subject, 120_000);
      });

      await test.step("the killed replica starts again", async () => {
        compose(["start", String(killed)]);
        await waitReady(DIRECT_PORTS[killed ?? "app-a"]);
        await waitReady(PROXY_PORT);
        killed = undefined;
      });

      const paused = logMark();
      await test.step("with imap paused, the mailbox says it can't reach the mail server", async () => {
        await search(page).fill("");
        compose(["pause", "imap"]);
        imapPaused = true;
        const status = page
          .getByRole("status")
          .filter({ hasText: "Can't reach the mail server since" });
        await expect(status.getByText(CANT_REACH)).toBeVisible({ timeout: 180_000 });
        await expect(status).toContainText("It's tried again on its own.");
        // The server is away: the status doesn't send her to the port or security settings.
        await expect(status).not.toContainText("secure connection");
        await expect
          .poll(
            () =>
              logSince(paused).filter(
                (l) =>
                  mine(l) &&
                  l.event === "sync.failed" &&
                  l.level === "warn" &&
                  l.cause === "mail_unavailable" &&
                  typeof l.mailboxId === "string",
              ).length,
          )
          .toBeGreaterThan(0);
      });

      await test.step("unpaused, the status recovers and new mail flows again", async () => {
        compose(["unpause", "imap"]);
        imapPaused = false;
        seed(["deliver", RECOVERY.id]);
        // A failed sync waits out its back-off before the next try (F1.4).
        await expect(page.getByText("Synced just now", { exact: true })).toBeVisible({
          timeout: 5 * 60_000,
        });
        await expectArrived(page, RECOVERY.subject, 120_000);
        await search(page).fill("");
      });

      await test.step("logs: every failed sync was retried only after its back-off", async () => {
        const syncs = logSince(paused)
          .filter((l) => mine(l) && SYNC_EVENTS.includes(String(l.event)))
          .sort((a, b) => String(a.time).localeCompare(String(b.time)));
        const failures = syncs.filter((l) => l.event === "sync.failed");
        expect(failures.length).toBeGreaterThan(0);
        for (const failed of failures) {
          const retry = syncs.find(
            (l) => l.event === "sync.started" && String(l.time) > String(failed.time),
          );
          expect(retry, `a retry after the failure at ${failed.time}`).toBeDefined();
          const waited = Date.parse(String(retry?.time)) - Date.parse(String(failed.time));
          expect(waited, `the retry after ${failed.time}`).toBeGreaterThanOrEqual(
            Number(failed.retryInSeconds) * 1000 - EARLY_RETRY_MS,
          );
        }
      });

      await test.step("a new UIDVALIDITY keeps every correction, decision and draft", async () => {
        const before = await snapshot(page);
        const created = logged("draft.created", { workspaceId }).length;
        const asked = logged("decision.created", { workspaceId }).length;
        const reset = logMark();
        seed(["reset-uidvalidity", "maria"]);
        await expect
          .poll(
            () => {
              const lines = logSince(reset).filter(mine);
              const changed = lines.findIndex(
                (l) => l.event === "sync.uidvalidity_changed" && l.folder === "INBOX",
              );
              return changed >= 0 && lines.slice(changed).some((l) => l.event === "sync.completed");
            },
            { timeout: 5 * 60_000, intervals: [2_000] },
          )
          .toBe(true);
        const after = await snapshot(page);
        expect(after).toEqual(before);
        expect(logged("draft.created", { workspaceId })).toHaveLength(created);
        expect(logged("decision.created", { workspaceId })).toHaveLength(asked);
      });

      await test.step("logs: lease expired, sync failed, UIDVALIDITY changed, no errors", async () => {
        const events = logSince(mark)
          .filter(mine)
          .map((l) => l.event);
        for (const event of ["job.lease_expired", "sync.failed", "sync.uidvalidity_changed"]) {
          expect(events).toContain(event);
        }
        expect(errorsSince(mark)).toEqual([]);
      });
    },
    async () => {
      if (imapPaused) compose(["unpause", "imap"]);
      if (killed) compose(["start", killed]);
      for (const replica of REPLICAS) await waitReady(DIRECT_PORTS[replica]);
      await waitReady(PROXY_PORT);
    },
  );
});
