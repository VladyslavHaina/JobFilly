import { expect, type Page, test } from "@playwright/test";
import {
  delivery,
  errorsSince,
  inboxRow,
  inspectDrafts,
  logged,
  logMark,
  logSince,
  openMessage,
  openPage,
  remember,
  repliesTo,
  roleParts,
  seed,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S5 of MVP 2: decisions (F7.1–F7.6, F4.3, F4.6). The Zurich and Basel roles pay in
// CHF and her minimum is in EUR, so pay is unknown and one decision asks for a minimum in CHF;
// the Dublin role's draft asked whether she would relocate. The decision ids the Decisions page
// loads are kept for S10's viewer probe (remember), as the walkthrough read them there.

const ZURICH = delivery("zurich");
const BASEL = delivery("basel");
const DUBLIN = delivery("dublin");
const ZURICH_2 = delivery("zurich-2");

const CHF_QUESTION = "Minimum pay in CHF per year?";
const RELOCATION_QUESTION = "Would you relocate to Ireland?";

const decision = (page: Page, question: string) =>
  page.getByRole("article", { name: question, exact: true });

const firstLine = (text: string | undefined) => text?.split("\n")[0] ?? "";

test("S5: decisions", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);

  // Every decision list the browser loads, by question.
  const decisionIds = new Map<string, string>();
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname !== `/api/workspaces/${workspaceId}/decisions`) return;
    if (response.request().method() !== "GET" || !response.ok()) return;
    try {
      const { items } = (await response.json()) as { items: { id: string; question: string }[] };
      for (const item of items) decisionIds.set(item.question, item.id);
    } catch {
      // A body the page no longer holds: the next load has it.
    }
  });

  await test.step("before any answer, the Zurich role's pay is unknown: different currency", async () => {
    await openMessage(page, ZURICH.subject);
    const { fit, draft } = roleParts(page);
    const pay = ZURICH.roles[0]?.facts.pay?.asWritten ?? "";
    await expect(fit).toContainText(`${pay} — different currency`);
    await expect(draft).toContainText(`Waiting for your answer: ${CHF_QUESTION}`);
  });

  await test.step("the decision inbox asks each question once, with the messages waiting on it", async () => {
    await openPage(page, "Decisions");
    const chf = decision(page, CHF_QUESTION);
    await expect(chf).toContainText("2 messages are waiting on this:");
    for (const d of [ZURICH, BASEL]) {
      await expect(chf.getByRole("link", { name: d.subject, exact: true })).toBeVisible();
    }
    const relocation = decision(page, RELOCATION_QUESTION);
    await expect(relocation).toContainText("1 message is waiting on this:");
    await expect(relocation.getByRole("link", { name: DUBLIN.subject, exact: true })).toBeVisible();
    for (const card of [chf, relocation]) {
      await expect(card.getByRole("radio", { name: "Something else", exact: true })).toBeVisible();
      await expect(
        card.getByRole("checkbox", { name: "Use this answer for similar mail", exact: true }),
      ).toBeChecked();
    }
    // Answers to click: the amounts the roles offer.
    await expect(chf.getByRole("radio", { name: /^CHF [\d,]+ per year$/ }).first()).toBeVisible();
    for (const question of [CHF_QUESTION, RELOCATION_QUESTION]) {
      await expect.poll(() => decisionIds.get(question) ?? "", { message: question }).not.toBe("");
      remember(`decision:${question}`, decisionIds.get(question) ?? "");
    }
  });

  await test.step("relocation: Not now keeps it; Don't ask for this message closes it", async () => {
    const relocation = decision(page, RELOCATION_QUESTION);
    await relocation.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(relocation).toContainText("Kept for later. It stays here until you answer it.");
    await expect(relocation).toBeVisible();
    await relocation
      .getByRole("button", { name: `Don't ask for this message: ${DUBLIN.subject}`, exact: true })
      .click();
    await expect(relocation).toHaveCount(0);
  });

  let amount = "";
  await test.step("she answers CHF with a suggested amount, for similar mail too", async () => {
    const chf = decision(page, CHF_QUESTION);
    const suggested = chf.getByRole("radio", { name: /^CHF [\d,]+ per year$/ }).first();
    amount = (await suggested.locator("xpath=..").innerText()).trim();
    await suggested.check();
    await expect(
      chf.getByRole("checkbox", { name: "Use this answer for similar mail", exact: true }),
    ).toBeChecked();
    await chf.getByRole("button", { name: "Answer", exact: true }).click();
    await expect(chf).toHaveCount(0);
    await expect(
      page.getByText(
        "Nothing to decide. When a reply needs an answer your profile doesn't have, it waits here.",
      ),
    ).toBeVisible();
  });

  await test.step("within a minute both roles are re-scored and their drafts appear", async () => {
    await openPage(page, "Inbox");
    for (const d of [ZURICH, BASEL]) {
      await openMessage(page, d.subject);
      const { fit, draft } = roleParts(page);
      await expect(fit).toContainText(`meets your minimum of ${amount}`, { timeout: 60_000 });
      const card = draft.getByRole("article", { name: "Reply draft", exact: true });
      await expect(
        card.getByRole("img", { name: "Draft status: In mailbox", exact: true }),
      ).toBeVisible({ timeout: 60_000 });
      await expect(card).toContainText(firstLine(d.roles[0]?.answers[1]?.body));
    }
    const drafts = inspectDrafts("maria");
    for (const d of [ZURICH, BASEL]) expect(repliesTo(drafts, d.messageId), d.id).toHaveLength(1);
  });

  await test.step("the Dublin role has no draft", async () => {
    await openMessage(page, DUBLIN.subject);
    const { draft } = roleParts(page);
    await expect(draft).toContainText("No draft for this role.");
    await expect(draft.getByRole("article", { name: "Reply draft", exact: true })).toHaveCount(0);
    expect(repliesTo(inspectDrafts("maria"), DUBLIN.messageId)).toEqual([]);
  });

  await test.step("seed deliver zurich-2: no new decision, and its draft uses the answer", async () => {
    const before = logged("decision.created", { workspaceId }).length;
    seed(["deliver", "zurich-2"]);
    await page.getByLabel("Search sender or subject").fill(ZURICH_2.subject);
    await expect(inboxRow(page, ZURICH_2.subject)).toBeVisible({ timeout: 45_000 });
    await openMessage(page, ZURICH_2.subject);
    const { fit, draft } = roleParts(page);
    await expect(fit).toContainText(`meets your minimum of ${amount}`, { timeout: 60_000 });
    const card = draft.getByRole("article", { name: "Reply draft", exact: true });
    await expect(
      card.getByRole("img", { name: "Draft status: In mailbox", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText("the salary range you mention in CHF works for me");
    await openPage(page, "Decisions");
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.getByText(/^Nothing to decide\./)).toBeVisible();
    expect(logged("decision.created", { workspaceId })).toHaveLength(before);
  });

  await test.step("logs: decision.created ×2, decision.answered for similar mail", async () => {
    expect(logged("decision.created", { workspaceId })).toHaveLength(2);
    const answered = logSince(mark).filter(
      (l) => l.event === "decision.answered" && l.workspaceId === workspaceId,
    );
    expect(answered).toHaveLength(1);
    expect(answered[0]?.useForSimilar).toBe(true);
    expect(errorsSince(mark)).toEqual([]);
  });
});
