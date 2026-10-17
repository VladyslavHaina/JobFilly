import { expect, test } from "@playwright/test";
import {
  askAssistant,
  errorsSince,
  logMark,
  logSince,
  openAssistant,
  openPage,
  replicaLogText,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S9 of MVP 2: the assistant, unclear and not allowed (F8.1, F8.6, F8.7, F8.10).
// Maria talks to it from her profile page, where the rules show that a discarded proposal
// changed nothing. The message with E2E-CHAT-1 is also one the assistant can't do (inviting
// someone): the fake AI keys its answers without the marker. It is in the stored thread after a
// reload, and in neither replica's log; F8.10 is also proven by the run's leak check.

const UNCLEAR = "stop showing me bad jobs";
const CLARIFY = "Which jobs should I stop showing you?";
const CHOICE = "Hide onsite roles";
const SEND = "send my reply to the Berlin recruiter";
const CHAT = "Invite Tom as an editor E2E-CHAT-1";
const GERMAN = "Welche Regeln habe ich gerade?";
const NO_RULES = "No rules yet. Ask the assistant to add one.";

test("S9: assistant, unclear and not allowed", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  await openPage(page, "Profile");
  await expect(page.getByText(NO_RULES)).toBeVisible();
  const panel = await openAssistant(page);
  // A reply bubble: the assistant's words, after "Assistant: " for screen readers.
  const reply = (text: string) =>
    panel.getByText(text, { exact: false }).filter({ hasText: "Assistant:" }).last();

  await test.step("an unclear request gets a clarifying question with choices", async () => {
    await askAssistant(panel, UNCLEAR);
    const question = panel.getByRole("group", { name: CLARIFY, exact: true }).last();
    await expect(question).toBeVisible({ timeout: 10_000 });
    for (const choice of ["Hide roles that pay below my minimum", CHOICE, "Hide job alerts"]) {
      await expect(question.getByRole("button", { name: choice, exact: true })).toBeEnabled();
    }
    await question.getByRole("button", { name: CHOICE, exact: true }).click();
  });

  await test.step("picking one gives a proposal; Discard leaves everything as it was", async () => {
    const card = panel.getByRole("article", { name: `Proposal: ${CHOICE}`, exact: true });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(card.getByText("Discarded", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
    await expect(page.getByText(NO_RULES)).toBeVisible();
  });

  await test.step("asked to send mail, it says it can't, and where drafts are reviewed", async () => {
    await askAssistant(panel, SEND);
    const answer = reply("I can't send mail.");
    await expect(answer).toBeVisible({ timeout: 10_000 });
    await expect(answer).toContainText("Drafts page");
  });

  await test.step("asked to invite someone (with E2E-CHAT-1), it says it can't", async () => {
    await askAssistant(panel, CHAT);
    await expect(reply("I can't invite people.")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("a message in German gets a reply in German", async () => {
    await askAssistant(panel, GERMAN);
    await expect(reply("Ich kann dein Profil und deine Regeln ändern")).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step("after a reload the stored thread still has the E2E-CHAT-1 message", async () => {
    await page.reload();
    await expect(page.getByText(NO_RULES)).toBeVisible();
    const reopened = await openAssistant(page);
    await expect(reopened.getByText(CHAT, { exact: false })).toBeVisible();
    await expect(reopened.getByText(GERMAN, { exact: false })).toBeVisible();
  });

  await test.step("logs: the messages and the discarded proposal, never their words", async () => {
    const mine = logSince(mark).filter((l) => l.workspaceId === workspaceId);
    expect(mine.filter((l) => l.event === "assistant.message").length).toBeGreaterThanOrEqual(5);
    expect(mine.some((l) => l.event === "assistant.proposal_created")).toBe(true);
    expect(mine.some((l) => l.event === "assistant.proposal_discarded")).toBe(true);
    expect(mine.some((l) => l.event === "assistant.proposal_applied")).toBe(false);
    const text = replicaLogText();
    expect(text).not.toContain("E2E-CHAT");
    for (const words of [UNCLEAR, SEND, GERMAN, CLARIFY]) expect(text).not.toContain(words);
    expect(errorsSince(mark)).toEqual([]);
  });
});
