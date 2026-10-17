import { expect, type Locator, test } from "@playwright/test";
import { fixturesDir, readJson } from "../../fixtures/format.ts";
import { type AssistantQuestion, MVP3_PATHS } from "../../fixtures/format-mvp3.ts";
import {
  answerLinks,
  askAssistant,
  delivery,
  errorsSince,
  logMark,
  logSince,
  openAssistant,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S9 of docs/mvp/MVP-3.md: ask the assistant (F8.1, F8.2, F8.4). Maria asks the three questions
// of assistant/questions.json marked S9. The fake AI asks for read-only lookups (assistant.v1)
// and answers from their results (answer.v1, ai/answer.json); the server keeps only the links
// its lookups returned (TBD-449), so "What's waiting on me?" links exactly the drafts not reviewed
// yet and any open decision. The Singapore role got no draft for its place conflict. Two
// interviews in the last 30 days (TBD-449): Nordlicht's invite and Brandung, which S6 moved to
// Interview by hand; Lindwurm has moved on to an offer.

const questions = readJson<AssistantQuestion[]>(`${fixturesDir()}${MVP3_PATHS.questions}`);
const answers = readJson<Record<string, Record<string, { text: string }>>>(
  `${fixturesDir()}ai/answer.json`,
);
const SINGAPORE = delivery("singapore");
const BERLIN = delivery("berlin-de");
const BRANDUNG = delivery("brandung-applied");

function question(id: string): { text: string; answer: string } {
  const q = questions.find((x) => x.id === id);
  expect(q?.scenario, id).toBe("S9");
  expect(q?.asker, id).toBe("maria");
  const text = q?.text ?? "";
  return { text, answer: answers[text.toLowerCase()]?.["*"]?.text ?? "" };
}

/** A link under an answer, as the panel words it: "Role: <title> at <company>". */
const linkTo = (
  kind: "Role" | "Draft",
  facts: { title: string | null; company: string | null } | undefined,
) => `${kind}: ${facts?.title} at ${facts?.company}`;

/** Asks the question and waits for its answer's words in the panel. */
async function ask(panel: Locator, q: { text: string; answer: string }) {
  expect(q.answer).not.toBe("");
  await askAssistant(panel, q.text);
  await expect(panel.getByText(q.answer, { exact: false }).last()).toBeVisible({
    timeout: 15_000,
  });
}

test("S9: ask the assistant", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  const panel = await openAssistant(page);

  await test.step(`"What's waiting on me?": open decisions and unreviewed drafts, linked`, async () => {
    await ask(panel, question("waiting"));
    const links = await answerLinks(panel);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toMatch(/^(Draft|Decision): /);
    // S5 sent the Berlin reply: it waits on nobody any more.
    expect(links).not.toContain(linkTo("Draft", BERLIN.roles[0]?.facts));
  });

  await test.step(`"Why didn't the Singapore role get a draft?": the place conflict, linked`, async () => {
    await ask(panel, question("singapore"));
    const link = linkTo("Role", SINGAPORE.roles[0]?.facts);
    expect(await answerLinks(panel)).toEqual([link]);
    await panel
      .getByRole("list", { name: "Used in this answer", exact: true })
      .last()
      .getByRole("link", { name: link, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: SINGAPORE.subject, level: 2, exact: true }),
    ).toBeVisible();
  });

  await test.step(`"How many interviews did I have in the last 30 days?": two, linked`, async () => {
    const q = question("interviews");
    expect(questions.find((x) => x.id === "interviews")?.expected.count).toBe(2);
    await ask(panel, q);
    expect(q.answer).toMatch(/^Two /);
    // Linked to the two: Brandung, and Nordlicht (any role of its pipeline item, TBD-449).
    const brandung = linkTo("Role", BRANDUNG.roles[0]?.facts);
    const links = await answerLinks(panel);
    expect(links).toContain(brandung);
    expect(links.some((l) => /^Role: .* at Nordlicht/.test(l))).toBe(true);
    for (const l of links) expect(l === brandung || /^Role: .* at Nordlicht/.test(l), l).toBe(true);
  });

  await test.step("logs: assistant.answered with its sources, no errors", async () => {
    const answered = logSince(mark).filter(
      (l) => l.workspaceId === workspaceId && l.event === "assistant.answered",
    );
    expect(answered).toHaveLength(3);
    expect(answered.every((l) => typeof l.sources === "number" && l.sources > 0)).toBe(true);
    expect(errorsSince(mark)).toEqual([]);
  });
});
