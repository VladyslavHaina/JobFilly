import { expect, type Locator, type Page, test } from "@playwright/test";
import { PERSONA_ADDRESSES } from "../../fixtures/format.ts";
import { ACCOUNTS } from "../../seed/accounts.ts";
import {
  apiContext,
  apiSignIn,
  cardHeaded,
  cvName,
  delivery,
  errorsSince,
  inspectDrafts,
  inspectSent,
  inspectSmtp,
  logMark,
  logSince,
  openMessage,
  openPage,
  openSettingsTab,
  repliesTo,
  roleParts,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S5 of docs/mvp/MVP-3.md: send, then undo (F4.1–F4.5, F9.1). Maria adds SMTP settings to her
// main mailbox: the Gmail preset fills its server, then she points it at the test mail server's
// plain SMTP port (imap:3025, as the test stack allows) and tests it. MVP 2's S4 discarded the
// Berlin draft, so she asks for a new one with Draft a reply, then presses Send…: the
// confirmation shows the message as it will leave. She confirms and presses Undo within the 10
// seconds: nothing reaches the mail server. Then she sends it again and lets it go. Verification
// with `seed inspect smtp` and `seed inspect sent maria`. On the remote EU draft from S1 she opens
// the confirmation, then edits the draft: Send… shows it as it is now. Probes: a send without a
// token, and one with the token the confirmation had before the edit, are both refused.

const MAIN = PERSONA_ADDRESSES.maria;
const BERLIN = delivery("berlin-de");
const OTHER = delivery("remote-eu-3");
const BACKEND_DE = cvName("maria", "Backend (DE)");
/** The draft Draft a reply writes for it (the fake AI's draft.v1 answer). */
const ANSWER = BERLIN.roles[0]?.answers[1];
const GREETING = ANSWER?.body.split("\n")[0] ?? "";
const SUBJECT = ANSWER?.subject ?? "";
const EDITED =
  "Hi Pieter,\n\nThanks for getting in touch. A call later this week works well for me.\n\nBest regards,\nMaria Santos";
const EDITED_LINE = "A call later this week works well for me.";

const draftCard = (page: Page): Locator =>
  roleParts(page).draft.getByRole("article", { name: "Reply draft", exact: true });
const confirmation = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Send this reply?", exact: true });
const messageText = (dialog: Locator) =>
  dialog.getByRole("region", { name: "Message text", exact: true });

/** The same text, whatever line endings and trailing space it was stored with. */
const plain = (text: string | null | undefined) =>
  (text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();

test("S5: send, then undo", async ({ page, playwright, baseURL }) => {
  test.setTimeout(8 * 60_000);
  const mark = logMark();
  const api = await apiContext(playwright.request, baseURL);
  expect(GREETING).not.toBe("");

  try {
    await signIn(page, "maria");
    await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
    const workspaceId = workspaceIdOf(page);
    const workspaceApi = `/api/workspaces/${workspaceId}`;

    await test.step("she adds SMTP settings to her main mailbox; the preset fills them; Test", async () => {
      await openSettingsTab(page, "Sending");
      const card = cardHeaded(page, MAIN);
      await expect(card).toContainText("Add its SMTP server to send drafts from it.");
      const provider = card.getByRole("combobox", { name: "Provider", exact: true });
      await provider.selectOption({ label: "Gmail" });
      const server = card.getByRole("textbox", { name: "SMTP server", exact: true });
      const port = card.getByRole("spinbutton", { name: "Port", exact: true });
      const security = card.getByRole("combobox", { name: "Security", exact: true });
      await expect(server).toHaveValue("smtp.gmail.com");
      await expect(port).toHaveValue("465");
      await expect(security).toHaveValue("tls");
      // The test stack's mail server instead: plain SMTP on 3025.
      await server.fill("imap");
      await expect(provider).toHaveValue("other");
      await port.fill("3025");
      await security.selectOption({ label: "None (plain text)" });
      await expect(card.getByRole("textbox", { name: "User name", exact: true })).toHaveValue(MAIN);
      await card.getByLabel("Password", { exact: true }).fill(ACCOUNTS.maria.password);
      await card.getByRole("button", { name: "Test", exact: true }).click();
      await expect(
        card.getByText("The SMTP server accepted the sign-in.", { exact: true }),
      ).toBeVisible();
      await card.getByRole("button", { name: "Save", exact: true }).click();
      await expect(card.getByText("Saved.", { exact: true })).toBeVisible();
      await expect(card).toContainText("Drafts of this mailbox can be sent.");
    });

    await test.step("the Berlin draft: Draft a reply writes it again", async () => {
      await openPage(page, "Inbox");
      await openMessage(page, BERLIN.subject);
      const { draft } = roleParts(page);
      await expect(draft).toContainText(
        "You discarded the draft for this role, so no new one is written on its own.",
      );
      await draft.getByRole("button", { name: "Draft a reply", exact: true }).click();
      const card = draftCard(page);
      await expect(
        card.getByRole("img", { name: "Draft status: In mailbox", exact: true }),
      ).toBeVisible({ timeout: 60_000 });
      await expect(card).toContainText("Drafted on request · DE · CV attached");
      await expect(card).toContainText(GREETING);
    });

    let shown = "";
    await test.step("Send…: the confirmation shows recipient, subject, attachment and text", async () => {
      await draftCard(page).getByRole("button", { name: "Send…", exact: true }).click();
      const dialog = confirmation(page);
      await expect(messageText(dialog)).toBeVisible({ timeout: 30_000 });
      await expect(dialog).toContainText(`From${MAIN}`);
      const to = BERLIN.from.name
        ? `${BERLIN.from.name} <${BERLIN.from.address}>`
        : BERLIN.from.address;
      await expect(dialog).toContainText(`To${to}`);
      await expect(dialog).toContainText(`Subject${SUBJECT}`);
      await expect(dialog).toContainText(new RegExp(`Attached${BACKEND_DE}\\.docx \\(\\d+ KB\\)`));
      await expect(messageText(dialog)).toContainText(GREETING);
      await expect(dialog).toContainText(
        "It leaves 10 seconds after you press Send; until then you can undo it.",
      );
      shown = plain(await messageText(dialog).locator("pre").textContent());
      expect(shown).toContain(GREETING);
    });

    await test.step("she confirms and presses Undo within the 10 seconds: nothing is sent", async () => {
      const dialog = confirmation(page);
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const card = draftCard(page);
      await expect(
        card.getByRole("status").filter({ hasText: /^Sending in \d+ s$/ }),
      ).toBeVisible();
      await card.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(card.getByText("Undone: nothing was sent.", { exact: true })).toBeVisible();
      await expect(
        card.getByRole("img", { name: "Draft status: In mailbox", exact: true }),
      ).toBeVisible();
      // Past the moment it would have left.
      await page.waitForTimeout(12_000);
      expect(inspectSmtp().messages).toEqual([]);
      expect(repliesTo(inspectDrafts("maria"), BERLIN.messageId)).toHaveLength(1);
    });

    await test.step("she sends it again and lets it go: the draft shows Sent", async () => {
      const card = draftCard(page);
      await card.getByRole("button", { name: "Send…", exact: true }).click();
      const dialog = confirmation(page);
      await expect(messageText(dialog)).toBeVisible({ timeout: 30_000 });
      expect(plain(await messageText(dialog).locator("pre").textContent())).toBe(shown);
      await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(card.getByRole("img", { name: "Draft status: Sent", exact: true })).toBeVisible({
        timeout: 60_000,
      });
    });

    await test.step("verification: one message over SMTP, one copy in Sent, the draft gone", async () => {
      const smtp = inspectSmtp().messages;
      expect(smtp).toHaveLength(1);
      expect(smtp[0]?.account).toBe(BERLIN.from.address);
      const sent = inspectSent("maria").messages;
      expect(sent).toHaveLength(1);
      const [copy] = sent;
      expect(copy?.inReplyTo?.trim()).toBe(BERLIN.messageId);
      expect(copy?.messageId).toBe(smtp[0]?.messageId);
      expect(plain(copy?.text)).toBe(shown);
      expect(copy?.attachments.map((a) => a.filename)).toEqual([`${BACKEND_DE}.docx`]);
      expect(repliesTo(inspectDrafts("maria"), BERLIN.messageId)).toEqual([]);
    });

    await test.step("the activity log shows it", async () => {
      await openPage(page, "Activity");
      const role = BERLIN.roles[0]?.facts;
      const entry = page
        .getByRole("list", { name: "Activity", exact: true })
        .getByRole("listitem")
        .filter({ hasText: `Sent the reply: ${role?.title} at ${role?.company}` });
      await expect(entry).toHaveCount(1);
      await expect(entry).toContainText("Maria Santos");
      // The app's usual date and time, as in "Oct 17, 2026, 1:15 AM".
      await expect(entry.locator("time")).toHaveText(
        /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s[AP]M$/,
      );
    });

    let oldToken = "";
    let otherDraft = "";
    await test.step("another draft: she opens its confirmation, then edits the draft", async () => {
      await openPage(page, "Inbox");
      await openMessage(page, OTHER.subject);
      const card = draftCard(page);
      await expect(
        card.getByRole("img", { name: "Draft status: In mailbox", exact: true }),
      ).toBeVisible();
      await card.getByRole("button", { name: "Send…", exact: true }).click();
      const dialog = confirmation(page);
      await expect(messageText(dialog)).toBeVisible({ timeout: 30_000 });
      await expect(messageText(dialog)).not.toContainText(EDITED_LINE);

      // Probe: the confirmation's token for the draft as it is now, from her own session.
      await apiSignIn(api, "maria");
      const listed = await api.get(`${workspaceApi}/drafts`);
      expect(listed.status()).toBe(200);
      const { items } = (await listed.json()) as {
        items: { id: string; messageId: string; position: number; status: string }[];
      };
      otherDraft = items.find((d) => d.messageId === OTHER.messageId && d.position === 0)?.id ?? "";
      expect(otherDraft, "the remote EU role's draft").not.toBe("");
      const preview = await api.get(`${workspaceApi}/drafts/${otherDraft}/send`);
      expect(preview.status()).toBe(200);
      oldToken = ((await preview.json()) as { token: string }).token;

      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await card.getByRole("button", { name: "Edit", exact: true }).click();
      await card.getByRole("textbox", { name: "Reply", exact: true }).fill(EDITED);
      await card.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        card.getByRole("img", { name: "Draft status: Edited", exact: true }),
      ).toBeVisible({
        timeout: 30_000,
      });
    });

    await test.step("sending asks to confirm again: Send… shows the draft as it is now", async () => {
      const card = draftCard(page);
      await card.getByRole("button", { name: "Send…", exact: true }).click();
      const dialog = confirmation(page);
      await expect(messageText(dialog)).toContainText(EDITED_LINE, { timeout: 30_000 });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step("probes: a send without a token, and one with the older token, are refused", async () => {
      const send = `${workspaceApi}/drafts/${otherDraft}/send`;
      expect((await api.post(send, { data: {} })).status()).toBe(400);
      const stale = await api.post(send, { data: { token: oldToken } });
      expect(stale.status()).toBe(409);
      expect(((await stale.json()) as { error?: string }).error).toBe("confirm_again");
      // Nothing left: the draft is still only edited, and still only one message went out.
      await page.reload();
      await expect(
        draftCard(page).getByRole("img", { name: "Draft status: Edited", exact: true }),
      ).toBeVisible();
      expect(inspectSmtp().messages).toHaveLength(1);
    });

    await test.step("logs: send.confirmed, send.undone, send.completed, no errors", async () => {
      const mine = logSince(mark).filter((l) => l.workspaceId === workspaceId);
      expect(mine.filter((l) => l.event === "send.confirmed")).toHaveLength(2);
      expect(mine.filter((l) => l.event === "send.undone")).toHaveLength(1);
      const completed = mine.filter((l) => l.event === "send.completed");
      expect(completed).toHaveLength(1);
      expect(completed[0]?.sentCopy).toBe("appended");
      expect(errorsSince(mark)).toEqual([]);
    });
  } finally {
    await api.dispose();
  }
});
