import { expect, test } from "@playwright/test";
import {
  type EnvelopeEntry,
  type ExpectedFileMvp2,
  fixturesDir,
  MARIA_KEY_MESSAGES,
  personaPaths,
  readJson,
} from "../../fixtures/format.ts";
import {
  delivery,
  errorsSince,
  fitScore,
  inspectDrafts,
  logMark,
  openMessage,
  repliesTo,
  roleParts,
  signIn,
} from "../shared.ts";

// S7 of docs/mvp/MVP-2.md: conflicts and policy (F4.2, F6.1, F1.6). The hybrid Amsterdam role
// (Maria removed Amsterdam in MVP 1) and the onsite Singapore role are capped by a hard conflict
// on her places, listed first. A job alert never gets a draft: the newest one, from today, is
// inside the reply window. The German recruiter's Berlin role from the first scan's backlog
// matches well but arrived before the 14-day reply window, so it has no automatic draft.

const dir = fixturesDir();
const envelopes = readJson<EnvelopeEntry[]>(`${dir}${personaPaths("maria").envelopes}`);
const expected = readJson<ExpectedFileMvp2>(`${dir}${personaPaths("maria").expected}`);

function backlog(messageId: string) {
  const envelope = envelopes.find((e) => e.messageId === messageId);
  const truth = expected.messages[messageId];
  if (!envelope || !truth) throw new Error(`${messageId} is not in Maria's fixtures`);
  return { messageId, subject: envelope.subject, truth };
}

const ALERT = backlog(MARIA_KEY_MESSAGES.multiRoleAlert);
const OLD_MATCH = backlog(MARIA_KEY_MESSAGES.germanRecruiter);

test("S7: conflicts and policy", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();

  for (const id of ["amsterdam", "singapore"]) {
    const d = delivery(id);
    await test.step(`${d.subject}: capped at 40, the conflict listed first, no draft`, async () => {
      expect(d.roles[0]?.hardConflicts).toEqual(["places"]);
      await openMessage(page, d.subject);
      const { fit, draft } = roleParts(page);
      const { score, capped } = await fitScore(fit);
      expect(capped).toBe(true);
      expect(score).toBeLessThanOrEqual(40);
      await expect(fit).toContainText("Capped at 40: a hard conflict");
      const first = fit
        .getByRole("list", { name: "Why this fit score", exact: true })
        .getByRole("listitem")
        .first();
      await expect(first).toContainText("Hard conflict");
      await expect(first).toContainText("Places");
      await expect(draft).toContainText("No draft for this role.");
      expect(repliesTo(inspectDrafts("maria"), d.messageId)).toEqual([]);
    });
  }

  await test.step("a job alert from today never gets a draft", async () => {
    expect(ALERT.truth.category).toBe("job_alert");
    expect(ALERT.truth.outsideReplyWindow).toBe(false);
    const roles = ALERT.truth.roles ?? [];
    expect(roles.length).toBeGreaterThan(1);
    await openMessage(page, ALERT.subject);
    for (const [i] of roles.entries()) {
      const { fit, draft } = roleParts(page, i + 1);
      await fitScore(fit);
      await expect(draft).toContainText("No draft for this role.");
    }
    expect(repliesTo(inspectDrafts("maria"), ALERT.messageId)).toEqual([]);
  });

  await test.step("a good match from the backlog, older than 14 days, has a match but no draft", async () => {
    expect(OLD_MATCH.truth.outsideReplyWindow).toBe(true);
    await openMessage(page, OLD_MATCH.subject);
    const { fit, draft } = roleParts(page);
    const { score, capped } = await fitScore(fit);
    expect(capped).toBe(false);
    expect(score).toBeGreaterThanOrEqual(70);
    await expect(fit.getByRole("list", { name: "Why this fit score", exact: true })).toBeVisible();
    await expect(draft).toContainText("No draft for this role.");
    expect(repliesTo(inspectDrafts("maria"), OLD_MATCH.messageId)).toEqual([]);
  });

  await test.step("logs: no errors", async () => {
    expect(errorsSince(mark)).toEqual([]);
  });
});
