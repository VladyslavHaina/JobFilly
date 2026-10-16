import { expect, test } from "@playwright/test";
import {
  type EnvelopeEntry,
  fixturesDir,
  MARIA_KEY_MESSAGES,
  personaPaths,
  readJson,
  type SenderVerdict,
} from "../../fixtures/format.ts";
import {
  deliveriesOf,
  errorsSince,
  fitScore,
  inboxRow,
  type LogLine,
  logMark,
  logSince,
  openMessage,
  openSettingsTab,
  roleParts,
  seed,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S2 of docs/mvp/MVP-2.md: new mail flows in (F1.1, F1.2, F1.5, F1.6). `seed deliver S2` brings
// the batch (every delivery but the second Zurich role, which S5 delivers, and S11's two). Maria
// keeps the inbox open and never reloads it: the messages come in live, each with its category,
// sender badge and fit score, within one sync interval (15 s in the test stack) plus processing.

const BATCH = deliveriesOf("S2");

/** The sync interval plus the processing the walkthrough measured (14 s for the batch). */
const ARRIVES_WITHIN_MS = 45_000;

/** The inbox's words for a sender verdict (the badge's name is "Sender check: <words>"). */
const VERDICT_WORDS: Record<SenderVerdict, string> = {
  looks_fine: "Looks fine",
  caution: "Caution",
  high_risk: "High risk",
};

const envelopes = readJson<EnvelopeEntry[]>(`${fixturesDir()}${personaPaths("maria").envelopes}`);
const backlogSubject =
  envelopes.find((e) => e.messageId === MARIA_KEY_MESSAGES.germanRecruiter)?.subject ?? "";

const SYNC_EVENTS = ["sync.started", "sync.completed", "sync.failed"];

/**
 * The syncs of a mailbox that started while another was running (F1.2), in `lines` from both
 * replicas: its sync lines in time order, an end before a start logged in the same millisecond.
 */
function overlappingSyncs(lines: LogLine[]): LogLine[] {
  const syncs = lines
    .filter((l) => SYNC_EVENTS.includes(String(l.event)))
    .sort(
      (a, b) =>
        String(a.time).localeCompare(String(b.time)) ||
        Number(a.event === "sync.started") - Number(b.event === "sync.started"),
    );
  const overlaps: LogLine[] = [];
  let running = false;
  for (const line of syncs) {
    if (line.event === "sync.started" && running) overlaps.push(line);
    running = line.event === "sync.started";
  }
  return overlaps;
}

test("S2: new mail flows in", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();

  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);

  await test.step("seed deliver S2: the batch arrives in her Inbox", async () => {
    expect(BATCH.map((d) => d.id)).not.toContain("zurich-2");
    seed(["deliver", "S2"]);
  });

  await test.step("without a reload, each message shows with category, badge and fit score", async () => {
    for (const d of BATCH) {
      const row = inboxRow(page, d.subject).filter({ hasText: d.from.name ?? d.from.address });
      await expect(row).toBeVisible({ timeout: ARRIVES_WITHIN_MS });
      await expect(row).toContainText("Recruiter outreach");
      await expect(
        row.getByRole("img", { name: `Sender check: ${VERDICT_WORDS[d.sender]}`, exact: true }),
      ).toBeVisible({ timeout: ARRIVES_WITHIN_MS });
      const fit = await fitScore(row);
      const [role] = d.roles;
      if (role?.fit === "capped") {
        expect(fit.capped, `${d.id} is capped`).toBe(true);
        expect(fit.score, d.id).toBeLessThanOrEqual(40);
      } else {
        expect(fit.capped, `${d.id} isn't capped`).toBe(false);
        if (role?.fit === "good") expect(fit.score, d.id).toBeGreaterThanOrEqual(70);
        else expect(fit.score, d.id).toBeLessThan(70);
      }
    }
  });

  await test.step("a delivered message shows its facts", async () => {
    const [remote] = BATCH.filter((d) => d.id === "remote-eu");
    const facts = remote?.roles[0]?.facts;
    if (!remote || !facts?.title || !facts.company) throw new Error("remote-eu states its role");
    await openMessage(page, remote.subject);
    const role = roleParts(page).facts;
    await expect(role).toContainText(facts.title);
    await expect(role).toContainText(facts.company);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/inbox$/);
  });

  await test.step("the first scan's backlog has sender checks and fit scores too (F1.6)", async () => {
    await page.getByLabel("Search sender or subject").fill(backlogSubject);
    const row = inboxRow(page, backlogSubject).first();
    await expect(row.getByRole("img", { name: /^Sender check: / })).toBeVisible();
    await fitScore(row);
    await page.getByLabel("Search sender or subject").fill("");
  });

  await test.step("the mailbox status says Synced just now", async () => {
    await expect(page.getByText("Synced just now", { exact: true })).toBeVisible();
  });

  await test.step("Settings › AI shows today's model calls and tokens", async () => {
    await openSettingsTab(page, "AI");
    await expect(page.getByRole("heading", { name: "Model usage", exact: true })).toBeVisible();
    // Days are UTC days, written in the browser's locale (en-US in playwright.config.ts).
    const today = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(),
    );
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: today, exact: true }) });
    await expect(row).toBeVisible();
    const [calls, tokens] = (await row.getByRole("cell").allInnerTexts()).map((t) =>
      Number(t.replace(/\D/g, "")),
    );
    expect(calls).toBeGreaterThan(0);
    expect(tokens).toBeGreaterThan(0);
  });

  await test.step("logs: syncs with the new mail, a pipeline line per message, one sync at a time", async () => {
    const since = () => logSince(mark).filter((l) => l.workspaceId === workspaceId);
    expect(since().some((l) => l.event === "sync.started" && typeof l.mailboxId === "string")).toBe(
      true,
    );
    await expect
      .poll(() =>
        since()
          .filter((l) => l.event === "sync.completed")
          .reduce((n, l) => n + Number(l.new ?? 0), 0),
      )
      .toBeGreaterThanOrEqual(BATCH.length);
    await expect
      .poll(
        () =>
          since().filter((l) => l.event === "pipeline.message_processed" && l.origin === "new")
            .length,
      )
      .toBeGreaterThanOrEqual(BATCH.length);
    expect(overlappingSyncs(since())).toEqual([]);
    expect(errorsSince(mark)).toEqual([]);
  });
});
