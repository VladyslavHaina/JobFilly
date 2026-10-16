import { expect, test } from "@playwright/test";
import { PERSONA_NAMES } from "../../fixtures/format.ts";
import {
  apiContext,
  apiSignIn,
  askAssistant,
  delivery,
  errorsSince,
  eventsSince,
  logMark,
  openAssistant,
  openMessage,
  openPage,
  recall,
  roleParts,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S10 of docs/mvp/MVP-2.md: roles (F6.7, F7.7, F8.8). Maria sets Tom back to Viewer; in her
// workspace he reads drafts, decisions and the assistant, but editing, answering and Apply are
// disabled, and the server refuses them (403). S5 answered or closed every decision, so the
// decision inbox has none open to look at (the walkthrough's gap): the answer probe uses the
// CHF decision S5 answered, whose id the browser read there (recall), and the viewer's disabled
// Answer is proven by apps/web/src/pages/decisions/decisions.test.tsx.

const BERLIN = delivery("berlin-de");
const VIEWER_REQUEST = "Stop showing me roles in the Netherlands";
const VIEWER_PROPOSAL = "Hide roles in the Netherlands";

test("S10: roles", async ({ page, browser, playwright, baseURL }) => {
  test.setTimeout(5 * 60_000);
  const mark = logMark();
  const tomContext = await browser.newContext({ baseURL });
  const tom = await tomContext.newPage();
  const tomApi = await apiContext(playwright.request, baseURL);

  try {
    await signIn(page, "maria");
    await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
    const workspaceId = workspaceIdOf(page);
    const workspaceApi = `/api/workspaces/${workspaceId}`;

    await test.step("Maria sets Tom back to Viewer", async () => {
      await openPage(page, "Members");
      const role = page.getByLabel(`Role for ${PERSONA_NAMES.tom}`);
      await expect(role).toHaveValue("editor");
      await role.selectOption({ label: "Viewer" });
      await expect(role).toHaveValue("viewer");
      await page.reload();
      await expect(page.getByLabel(`Role for ${PERSONA_NAMES.tom}`)).toHaveValue("viewer");
    });

    await test.step("Tom opens Maria's workspace", async () => {
      await signIn(tom, "tom");
      await expect(tom.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
      await tom.getByLabel("Workspace").selectOption({ label: "Maria Santos's workspace" });
      await expect(tom.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
      expect(workspaceIdOf(tom)).toBe(workspaceId);
    });

    await test.step("he reads the drafts; Edit and Discard are disabled", async () => {
      await openPage(tom, "Drafts");
      const edit = tom.getByRole("button", { name: "Edit", exact: true });
      const discard = tom.getByRole("button", { name: "Discard", exact: true });
      await expect(edit.first()).toBeVisible();
      for (const button of [...(await edit.all()), ...(await discard.all())]) {
        await expect(button).toBeDisabled();
      }
      await expect(
        tom.getByText("Viewers can read drafts but not change them.").first(),
      ).toBeVisible();
    });

    await test.step("he sees the decision inbox", async () => {
      await openPage(tom, "Decisions");
      await expect(
        tom.getByRole("heading", { name: "Decisions", level: 1, exact: true }),
      ).toBeVisible();
      await expect(tom.getByText(/^Nothing to decide\./)).toBeVisible();
    });

    await test.step("in a message, the category, Draft a reply and the marks are not his to change", async () => {
      await openPage(tom, "Inbox");
      await openMessage(tom, BERLIN.subject);
      await expect(tom.getByLabel("Category", { exact: true })).toBeDisabled();
      const { draft, cv } = roleParts(tom);
      await expect(
        draft.getByRole("button", { name: "Draft a reply", exact: true }),
      ).toBeDisabled();
      await expect(draft).toContainText("Only editors and admins can ask for one.");
      const sender = tom.getByRole("region", { name: "Sender check", exact: true });
      await expect(sender.getByRole("button", { name: "Trusted", exact: true })).toHaveCount(0);
      await expect(cv.getByRole("combobox")).toHaveCount(0);
    });

    await test.step("he chats with the assistant; Apply and Edit are disabled", async () => {
      const panel = await openAssistant(tom);
      await askAssistant(panel, VIEWER_REQUEST);
      const card = panel.getByRole("article", {
        name: `Proposal: ${VIEWER_PROPOSAL}`,
        exact: true,
      });
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card).toContainText("Only editors and admins can apply changes.");
      await expect(card.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
      await expect(card.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
    });

    await test.step("probes: Tom applying, answering and editing a draft get 403", async () => {
      await apiSignIn(tomApi, "tom");
      const state = await tomApi.get(`${workspaceApi}/assistant`);
      expect(state.status()).toBe(200);
      const { thread } = (await state.json()) as {
        thread: { proposals: { id: string; summary: string; status: string }[] } | null;
      };
      const proposal = thread?.proposals.find(
        (p) => p.summary === VIEWER_PROPOSAL && p.status === "open",
      );
      expect(proposal, "Tom's open proposal").toBeDefined();
      const apply = await tomApi.post(`${workspaceApi}/assistant/proposals/${proposal?.id}/apply`);
      expect(apply.status()).toBe(403);

      const chf = recall("decision:Minimum pay in CHF per year?");
      const answer = await tomApi.post(`${workspaceApi}/decisions/${chf}/answer`, {
        data: {
          value: {
            amount: 120000,
            currency: "CHF",
            period: "year",
            asWritten: "CHF 120,000 per year",
          },
          useForSimilar: true,
        },
      });
      expect(answer.status()).toBe(403);

      const listed = await tomApi.get(`${workspaceApi}/drafts`);
      expect(listed.status(), "a viewer reads the drafts").toBe(200);
      const { items } = (await listed.json()) as {
        items: { id: string; status: string; subject: string | null; body: string | null }[];
      };
      const live = items.find((d) => d.status === "in_mailbox" || d.status === "edited");
      expect(live, "a draft in the mailbox").toBeDefined();
      const edit = await tomApi.patch(`${workspaceApi}/drafts/${live?.id}`, {
        data: { subject: live?.subject ?? "Re:", body: `${live?.body ?? ""}\n(Tom)` },
      });
      expect(edit.status()).toBe(403);
      expect((await tomApi.post(`${workspaceApi}/drafts/${live?.id}/discard`)).status()).toBe(403);
    });

    await test.step("logs", async () => {
      expect(eventsSince(mark)).toContain("workspace.role_changed");
      expect(errorsSince(mark)).toEqual([]);
    });
  } finally {
    await tomApi.dispose();
    await tomContext.close();
  }
});
