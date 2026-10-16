import { expect, test } from "@playwright/test";
import {
  cvName,
  delivery,
  errorsSince,
  fitScore,
  inspectDrafts,
  inspectSmtp,
  logged,
  logMark,
  openMessage,
  repliesTo,
  roleParts,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S3 of docs/mvp/MVP-2.md: a good match gets a draft in the mailbox (F4.1, F4.4, F4.5, F2.3,
// F6.1–F6.3, F6.6). The Berlin role S2 delivered is in German and asks for a CV. Its draft was
// written automatically when it arrived; the verification steps are the seed's `inspect drafts`
// and `inspect smtp`.

const BERLIN = delivery("berlin-de");
const BACKEND_DE = cvName("maria", "Backend (DE)");

test("S3: a good match gets a draft in the mailbox", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const mark = logMark();
  const [role] = BERLIN.roles;
  const answer = role?.answers[1];
  if (!role || !answer) throw new Error("the Berlin role has an automatic draft answer");

  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  await openMessage(page, BERLIN.subject);
  const { fit, cv, draft } = roleParts(page);

  await test.step("it has a fit score of 70 or more, labelled fit score, with its reasons", async () => {
    const { score, capped } = await fitScore(fit);
    expect(capped).toBe(false);
    expect(score).toBeGreaterThanOrEqual(70);
    await expect(fit.getByText(`fit score ${score}`, { exact: true })).toBeVisible();
    await expect(fit).not.toContainText(/\bATS\b/);
    const reasons = fit.getByRole("list", { name: "Why this fit score", exact: true });
    await expect(reasons).toContainText("Berlin, hybrid — fits your 'Berlin, hybrid'");
    await expect(reasons.getByRole("listitem").first()).toBeVisible();
  });

  await test.step("matched and missing skills come from the CV", async () => {
    // Redis is in the role but in no CV: missing, never a fit, whatever the model says (F4.4).
    const skills = (title: string) =>
      fit.getByText(title, { exact: true }).locator("xpath=following-sibling::p[1]");
    await expect(skills("Skills missing")).toHaveText("Redis");
    for (const skill of ["Go", "PostgreSQL", "Kubernetes"]) {
      await expect(skills("Skills you have")).toContainText(skill);
    }
    await expect(skills("Skills you have")).not.toContainText("Redis");
  });

  await test.step(`the CV is ${BACKEND_DE}, with its reason`, async () => {
    await expect(cv).toContainText(`German backend role → ${BACKEND_DE}`);
  });

  await test.step("the draft is in German, written automatically, with the CV attached", async () => {
    const card = draft.getByRole("article", { name: "Reply draft", exact: true });
    await expect(
      card.getByRole("img", { name: "Draft status: In mailbox", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText("Written automatically · DE · CV attached");
    await expect(card).toContainText(answer.body.split("\n")[0] ?? "");
  });

  await test.step("verification: one draft in reply to it in the mailbox, threaded, with the CV", async () => {
    const replies = repliesTo(inspectDrafts("maria"), BERLIN.messageId);
    expect(replies).toHaveLength(1);
    const [reply] = replies;
    expect(reply?.draft).toBe(true);
    expect(reply?.references).toContain(BERLIN.messageId);
    expect(reply?.text).toContain(answer.body.split("\n")[0]);
    expect(reply?.attachments.map((a) => a.filename)).toEqual([`${BACKEND_DE}.docx`]);
  });

  await test.step("verification: nothing reached the mail server over SMTP", async () => {
    expect(inspectSmtp().messages).toEqual([]);
  });

  await test.step("logs: match.scored, draft.created and draft.saved_to_mailbox", async () => {
    expect(logged("match.scored", { workspaceId }).length).toBeGreaterThan(0);
    const created = logged("draft.created", {
      workspaceId,
      origin: "auto",
      language: "de",
      attachCv: true,
    });
    expect(created.length).toBeGreaterThan(0);
    const draftIds = created.map((l) => l.draftId);
    const saved = logged("draft.saved_to_mailbox", { workspaceId, attached: true });
    expect(saved.some((l) => draftIds.includes(l.draftId))).toBe(true);
    expect(errorsSince(mark)).toEqual([]);
  });
});
