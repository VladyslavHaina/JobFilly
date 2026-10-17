import { expect, type Page, test } from "@playwright/test";
import { fixturesDir, PERSONA_NAMES, readJson } from "../../fixtures/format.ts";
import { type AssistantQuestion, MVP3_PATHS } from "../../fixtures/format-mvp3.ts";
import {
  answerLinks,
  apiContext,
  apiSignIn,
  askAssistant,
  delivery,
  errorsSince,
  logMark,
  logSince,
  openAssistant,
  openMessage,
  openPage,
  roleParts,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S7 of docs/mvp/MVP-3.md: sharing with control (F6.1, F6.2, F8.3). Tom is a Viewer in Maria's
// workspace since MVP 2's S10; Maria changes what he sees to "Job pipeline only". In her
// workspace Tom then sees the roles, their facts and matches, and the pipeline, but no Drafts
// page, no draft and no message text (TBD-446 D14). Asked for a message's text, the assistant
// says it isn't available to him (assistant/questions.json, "body-pipeline-only"). Probes with
// Tom's own session: the message's body and a draft answer 404; Maria's control gets both.

const BERLIN = delivery("berlin-de");
const questions = readJson<AssistantQuestion[]>(`${fixturesDir()}${MVP3_PATHS.questions}`);
const QUESTION = questions.find((q) => q.id === "body-pipeline-only");
const answers = readJson<Record<string, Record<string, { text: string }>>>(
  `${fixturesDir()}ai/answer.json`,
);
const NOT_AVAILABLE = "That message's text isn't available to you";
const MARIAS = `${PERSONA_NAMES.maria}'s workspace`;

const nav = (page: Page) => page.getByRole("navigation", { name: "Main", exact: true });

test("S7: sharing with control", async ({ page, browser, playwright, baseURL }) => {
  test.setTimeout(6 * 60_000);
  const mark = logMark();
  const tomContext = await browser.newContext({ baseURL });
  const tom = await tomContext.newPage();
  const tomApi = await apiContext(playwright.request, baseURL);
  const mariaApi = await apiContext(playwright.request, baseURL);
  expect(QUESTION?.asker).toBe("tom");
  expect(QUESTION?.scenario).toBe("S7");
  const question = QUESTION?.text ?? "";
  expect(answers[question.toLowerCase()]?.["*"]?.text).toContain(NOT_AVAILABLE);

  try {
    await signIn(page, "maria");
    await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
    const workspaceId = workspaceIdOf(page);
    const workspaceApi = `/api/workspaces/${workspaceId}`;

    await test.step(`Maria changes what ${PERSONA_NAMES.tom} sees to Job pipeline only`, async () => {
      await openPage(page, "Members");
      const sees = page.getByLabel(`What ${PERSONA_NAMES.tom} sees`, { exact: true });
      await expect(sees).toHaveValue("everything");
      await sees.selectOption({ label: "Job pipeline only" });
      await expect(sees).toHaveValue("pipeline");
      await page.reload();
      await expect(page.getByLabel(`What ${PERSONA_NAMES.tom} sees`, { exact: true })).toHaveValue(
        "pipeline",
      );
    });

    await test.step("Tom opens Maria's workspace: no Drafts page", async () => {
      await signIn(tom, "tom");
      await expect(tom.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
      await tom.getByLabel("Workspace").selectOption({ label: MARIAS });
      await expect(tom.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
      expect(workspaceIdOf(tom)).toBe(workspaceId);
      await expect(nav(tom).getByRole("link", { name: "Pipeline", exact: true })).toBeVisible();
      await expect(nav(tom).getByRole("link", { name: "Drafts", exact: true })).toHaveCount(0);
    });

    await test.step("he sees the role, its facts and its match, but no draft and no text", async () => {
      await openMessage(tom, BERLIN.subject);
      const { facts, profile, fit, cv, draft } = roleParts(tom);
      await expect(facts).toContainText(BERLIN.roles[0]?.facts.company ?? "");
      await expect(profile).toContainText("→ '");
      await expect(
        fit.getByRole("list", { name: "Why this fit score", exact: true }),
      ).toBeVisible();
      await expect(cv).toBeVisible();
      await expect(draft).toHaveCount(0);
      await expect(
        tom
          .getByRole("region", { name: "Message", exact: true })
          .getByText(
            "The message's text isn't shown: you see this workspace's job pipeline only.",
            {
              exact: true,
            },
          ),
      ).toBeVisible();
      await expect(tom.getByTestId("message-body")).toHaveCount(0);
    });

    await test.step("he sees the pipeline", async () => {
      await openPage(tom, "Pipeline");
      await expect(
        tom.getByRole("heading", { name: "Pipeline", level: 1, exact: true }),
      ).toBeVisible();
      await expect(
        tom.getByRole("region", { name: "Offer", exact: true }).getByRole("article").first(),
      ).toBeVisible();
    });

    await test.step("asked for a message's text, the assistant says it isn't available", async () => {
      const panel = await openAssistant(tom);
      await askAssistant(panel, question);
      await expect(panel.getByText(NOT_AVAILABLE, { exact: false }).last()).toBeVisible({
        timeout: 15_000,
      });
      // Its link is the role, never the message or a draft.
      const links = await answerLinks(panel);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toMatch(/^Role: /);
      await expect(panel).not.toContainText("BODYSENTINEL");
      await panel.getByRole("button", { name: "Close the assistant", exact: true }).click();
    });

    await test.step("probes: Tom's session on the message's body and on a draft gets 404", async () => {
      await apiSignIn(mariaApi, "maria");
      const listed = await mariaApi.get(`${workspaceApi}/drafts`);
      expect(listed.status(), "Maria reads the drafts").toBe(200);
      const { items } = (await listed.json()) as { items: { id: string }[] };
      const draftId = items[0]?.id;
      expect(draftId, "a draft of hers").toBeDefined();
      const body = `${workspaceApi}/messages/${encodeURIComponent(BERLIN.messageId)}/body`;
      // The control: Maria gets both.
      expect((await mariaApi.get(body)).status()).toBe(200);
      expect((await mariaApi.get(`${workspaceApi}/drafts/${draftId}`)).status()).toBe(200);

      await apiSignIn(tomApi, "tom");
      expect((await tomApi.get(body)).status()).toBe(404);
      expect((await tomApi.get(`${workspaceApi}/drafts/${draftId}`)).status()).toBe(404);
      expect((await tomApi.get(`${workspaceApi}/drafts`)).status()).toBe(404);
    });

    await test.step("logs: member.scope_changed, assistant.answered, no errors", async () => {
      const mine = logSince(mark).filter((l) => l.workspaceId === workspaceId);
      expect(mine.some((l) => l.event === "member.scope_changed" && l.scope === "pipeline")).toBe(
        true,
      );
      expect(mine.some((l) => l.event === "assistant.answered")).toBe(true);
      expect(errorsSince(mark)).toEqual([]);
    });
  } finally {
    await Promise.all([tomApi.dispose(), mariaApi.dispose()]);
    await tomContext.close();
  }
});
