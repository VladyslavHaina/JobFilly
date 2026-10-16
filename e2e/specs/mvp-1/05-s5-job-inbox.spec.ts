import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  type Category,
  type EnvelopeEntry,
  type ExpectedFile,
  fixturesDir,
  type JobFacts,
  MARIA_KEY_MESSAGES,
  PERSONA_ADDRESSES,
  personaPaths,
  readJson,
} from "../../fixtures/format.ts";
import { COMPOSE_FILE, fileState } from "../../stack.ts";

// S5 of docs/mvp/MVP-1.md: the job inbox (F5.1–F5.5, F3.4, F3.5), after the first scan (S3).
// The messages it opens, their facts and categories come from Maria's fixtures. The category it
// corrects is the always-invalid message's, which the scan couldn't analyze: Maria sets it to
// what the mail is. It is marked narrow, so the inbox is walked again at 1024×768.

const LOGIN = "E2E-SECRET-maria-login";

const dir = fixturesDir();
const expected = readJson<ExpectedFile>(`${dir}${personaPaths("maria").expected}`);
const envelopes = readJson<EnvelopeEntry[]>(`${dir}${personaPaths("maria").envelopes}`);

function subjectOf(messageId: string): string {
  const envelope = envelopes.find((e) => e.messageId === messageId);
  if (!envelope) throw new Error(`${messageId} is not in Maria's envelopes.json`);
  return envelope.subject;
}

function truthOf(messageId: string) {
  const truth = expected.messages[messageId];
  if (!truth) throw new Error(`${messageId} is not in Maria's expected.json`);
  return truth;
}

/** The inbox's words for each category (the app's own). */
const CATEGORY_LABELS: Record<Category, string> = {
  recruiter_outreach: "Recruiter outreach",
  job_alert: "Job alert",
  application_update: "Application update",
  interview: "Interview",
  assessment: "Assessment",
  offer: "Offer",
  rejection: "Rejection",
  other_job: "Other job mail",
  not_job: "Not job",
};

const country = new Intl.DisplayNames(["en"], { type: "region" });

/** Pay normalised the way F5.2 writes it, e.g. "€75,000–85,000 per year". */
function normalisedPay(pay: NonNullable<JobFacts["pay"]>): string {
  const money = new Intl.NumberFormat("en", {
    style: "currency",
    currency: pay.currency ?? "",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  });
  const plain = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
  const amount =
    pay.min !== null && pay.max !== null && pay.min !== pay.max
      ? `${money.format(pay.min)}–${plain.format(pay.max)}`
      : money.format(pay.min ?? pay.max ?? 0);
  return `${amount} per ${pay.period}`;
}

const ROOT = resolve(import.meta.dirname, "../../..");
/** The running stack's compose project: the one stack.ts passes on, else e2e/.stack's. */
const project = process.env.JOBFILLY_E2E_PROJECT ?? fileState(join(ROOT, "e2e", ".stack")).read();
const REPLICAS = ["app-a", "app-b"];
type LogLine = { event?: unknown; [field: string]: unknown };

function replicaLog(replica: string): LogLine[] {
  if (!project) throw new Error('No test stack is up: start one with "pnpm e2e:stack up"');
  const args = ["compose", "-p", project, "-f", COMPOSE_FILE, "logs", "--no-color"];
  const out = execFileSync("docker", [...args, "--no-log-prefix", replica], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  return out.split("\n").flatMap((line) => {
    try {
      return line.startsWith("{") ? [JSON.parse(line) as LogLine] : [];
    } catch {
      return [];
    }
  });
}

async function signIn(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
  await page.getByLabel("Password").fill(LOGIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Job inbox" })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] ?? "";
}

const messageList = (page: Page) => page.getByRole("list", { name: "Messages" });
const search = (page: Page) => page.getByLabel("Search sender or subject");

/** Finds a message by its subject with the search field and opens it. */
async function open(page: Page, messageId: string) {
  const subject = subjectOf(messageId);
  await search(page).fill(subject);
  await messageList(page).getByRole("link").filter({ hasText: subject }).first().click();
  await expect(page.getByRole("heading", { name: subject, level: 2, exact: true })).toBeVisible();
}

/** The German recruiter's email with its facts (F5.2). */
async function checkGermanRecruiter(page: Page) {
  await open(page, MARIA_KEY_MESSAGES.germanRecruiter);
  const [facts] = truthOf(MARIA_KEY_MESSAGES.germanRecruiter).facts ?? [];
  if (!facts?.pay?.currency || !facts.workMode) {
    throw new Error("the German recruiter's facts state the pay, its currency and the work mode");
  }
  const role = page.getByRole("region", { name: "Role 1", exact: true });
  for (const place of facts.places) {
    const name = [place.city, place.country ? country.of(place.country) : null];
    await expect(role).toContainText(name.filter(Boolean).join(", "));
  }
  await expect(role).toContainText(facts.workMode.replace(/^./, (c) => c.toUpperCase()));
  await expect(role).toContainText(normalisedPay(facts.pay));
  await expect(role).toContainText(`As written: “${facts.pay.asWritten}”`);
  if (facts.contract) await expect(role).toContainText(facts.contract);
  // The body as plain text, fetched from the mailbox: its words, no markup.
  const body = page.getByRole("region", { name: "Message" });
  const opening = envelopes.find(
    (e) => e.messageId === MARIA_KEY_MESSAGES.germanRecruiter,
  )?.snippet;
  await expect(body).toContainText((opening ?? "").slice(0, 60), { timeout: 30_000 });
  await expect(body).not.toContainText("</");
}

test("S5: the job inbox", async ({ page, playwright, baseURL }) => {
  test.setTimeout(5 * 60_000);
  const workspaceId = await signIn(page);

  await test.step("non-job mail is hidden behind a count", async () => {
    const stageOneNotJob = Object.values(expected.messages).filter(
      (m) => m.stageOne === "not_job",
    ).length;
    const count = page.getByText(/^\d+ non-job emails? hidden$/);
    await expect(count).toBeVisible();
    expect(Number.parseInt(await count.innerText(), 10)).toBeGreaterThanOrEqual(stageOneNotJob);
    await expect(page.getByRole("button", { name: "Show", exact: true })).toBeVisible();
  });

  await test.step("the German recruiter's email: facts and the plain-text body", async () => {
    await checkGermanRecruiter(page);
  });

  await test.step("a job alert lists every role it contains", async () => {
    await open(page, MARIA_KEY_MESSAGES.multiRoleAlert);
    const roles = truthOf(MARIA_KEY_MESSAGES.multiRoleAlert).facts ?? [];
    expect(roles.length).toBeGreaterThan(1);
    await expect(page.getByRole("heading", { name: `${roles.length} roles` })).toBeVisible();
    for (const [i, role] of roles.entries()) {
      const region = page.getByRole("region", { name: `Role ${i + 1}`, exact: true });
      if (role.title) await expect(region).toContainText(role.title);
    }
  });

  await test.step("the prompt-injection message gets the category it deserves", async () => {
    await open(page, MARIA_KEY_MESSAGES.promptInjection);
    const truth = truthOf(MARIA_KEY_MESSAGES.promptInjection);
    await expect(page.getByLabel("Category", { exact: true })).toHaveValue(truth.category);
  });

  const invalid = MARIA_KEY_MESSAGES.alwaysInvalid;
  const corrected = truthOf(invalid).category;
  await test.step("the message the AI answers invalidly is “Couldn't analyze”", async () => {
    await open(page, invalid);
    await expect(page.getByText("Couldn't analyze", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Set the category" }).click();
    const select = page.getByLabel("Category", { exact: true });
    await expect(select).toBeFocused();
    await select.selectOption({ label: CATEGORY_LABELS[corrected] });
    await expect(page.getByText("Corrected by hand: later analysis keeps it.")).toBeVisible();
  });

  await test.step("the correction is kept after a reload", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: subjectOf(invalid), level: 2 })).toBeVisible();
    await expect(page.getByLabel("Category", { exact: true })).toHaveValue(corrected);
    await expect(page.getByText("Corrected by hand: later analysis keeps it.")).toBeVisible();
  });

  await test.step("filter Interview: only the interview invite", async () => {
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/inbox$/);
    await page.getByRole("button", { name: "Interview", exact: true }).click();
    const rows = messageList(page).getByRole("link");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(subjectOf(MARIA_KEY_MESSAGES.interviewInvite));
    // Nothing became an offer because the injected mail said so (F3.5).
    await page.getByRole("button", { name: "Offer", exact: true }).click();
    const offers = Object.entries(expected.messages)
      .filter(([, m]) => m.category === "offer")
      .map(([id]) => subjectOf(id));
    for (const text of await messageList(page).getByRole("link").allInnerTexts()) {
      expect(
        offers.some((subject) => text.includes(subject)),
        text,
      ).toBe(true);
    }
    await page.getByRole("button", { name: "All", exact: true }).click();
  });

  await test.step("search by sender", async () => {
    const sender = envelopes.find((e) => e.messageId === MARIA_KEY_MESSAGES.germanRecruiter)?.from;
    const name = sender?.name ?? sender?.address ?? "";
    await search(page).fill(name);
    const rows = messageList(page).getByRole("link");
    await expect
      .poll(async () => {
        const texts = await rows.allInnerTexts();
        return texts.length > 0 && texts.every((text) => text.includes(name));
      })
      .toBe(true);
    await search(page).fill("");
    // Unfiltered again once the search settles: the "not included" note goes away.
    await expect(page.getByRole("note", { name: "Not included" })).toHaveCount(0);
  });

  await test.step("keyboard only: Tab to the list, Enter opens, Esc closes", async () => {
    const first = messageList(page).getByRole("link").first();
    await expect(first).toBeVisible();
    await search(page).focus();
    for (let i = 0; i < 10; i++) {
      if (await first.evaluate((el) => el === el.ownerDocument.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/inbox\/[^/]+$/);
    await expect(page.getByRole("region", { name: "Message" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/inbox$/);
    await expect(first).toBeFocused();
  });

  await test.step("probe: the first page of the list, 20 times, p95 under a second", async () => {
    const origin = new URL(baseURL ?? "http://127.0.0.1:8080").origin;
    const api = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    try {
      const signIn = await api.post("/api/auth/sign-in", {
        data: { email: PERSONA_ADDRESSES.maria, password: LOGIN },
      });
      expect(signIn.status()).toBe(200);
      const times: number[] = [];
      for (let i = 0; i < 20; i++) {
        const started = performance.now();
        const response = await api.get(`/api/workspaces/${workspaceId}/messages`);
        await response.body();
        times.push(performance.now() - started);
        expect(response.status()).toBe(200);
      }
      times.sort((a, b) => a - b);
      expect(times[Math.ceil(0.95 * times.length) - 1]).toBeLessThan(1000);
    } finally {
      await api.dispose();
    }
  });

  await test.step("logs: the invalid answer was logged", async () => {
    const events = REPLICAS.flatMap(replicaLog).map((l) => l.event);
    expect(events).toContain("ai.output_invalid");
  });
});

test.describe("narrow", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("S5 at 1024×768: list, a message and a filter", async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/^\d+ non-job emails? hidden$/)).toBeVisible();
    await checkGermanRecruiter(page);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/inbox$/);
    await search(page).fill("");
    await page.getByRole("button", { name: "Interview", exact: true }).click();
    await expect(messageList(page).getByRole("link")).toHaveCount(1);
  });
});
