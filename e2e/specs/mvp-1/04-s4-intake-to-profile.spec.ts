import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  CORE_KEYS,
  type CoreKey,
  type ExpectedFile,
  fixturesDir,
  PERSONA_ADDRESSES,
  personaPaths,
  readJson,
} from "../../fixtures/format.ts";
import { COMPOSE_FILE, fileState } from "../../stack.ts";

// S4 of docs/mvp/MVP-1.md: from the intake form to the profile (F6.1–F6.5). The proposals are
// checked against Maria's expected.json (F6.6); she removes Amsterdam with a click and confirms.

const LOGIN = "E2E-SECRET-maria-login";

/** The intake form's label of each core question (the app's own words). */
const LABELS: Record<CoreKey, string> = {
  target_roles: "Roles you're looking for",
  seniority: "Seniority",
  places: "Places you'd work onsite or hybrid",
  remote: "Remote work",
  contracts: "Contracts",
  min_pay: "Minimum pay",
  languages: "Working languages",
  work_permits: "Work permits",
  reply_to: "Mail that should get a reply",
  deal_breakers: "Deal-breakers",
};

const expected = readJson<ExpectedFile>(`${fixturesDir()}${personaPaths("maria").expected}`);
const answers = expected.profile.answers;
const country = new Intl.DisplayNames(["en"], { type: "region" });

/** The chip text of an answer value that the form shows as written. */
function chips(key: CoreKey): string[] {
  switch (key) {
    case "target_roles":
    case "seniority":
    case "contracts":
    case "languages":
    case "deal_breakers":
      return answers[key].values;
    case "places":
      return answers.places.values.map(
        (p) => `${[p.city, country.of(p.country)].filter(Boolean).join(", ")} (${p.mode})`,
      );
    case "work_permits":
      return answers.work_permits.values.map((w) =>
        w.country ? `${w.text} (${country.of(w.country)})` : w.text,
      );
    default:
      return [];
  }
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

/** The events both replicas logged since `mark` (each replica's line count then). */
const eventsSince = (mark: number[]) =>
  REPLICAS.flatMap((replica, i) =>
    replicaLog(replica)
      .slice(mark[i])
      .map((l) => l.event),
  );

test("S4: intake form to profile", async ({ page }) => {
  const mark = REPLICAS.map((replica) => replicaLog(replica).length);
  const card = (key: CoreKey) => page.getByRole("region", { name: LABELS[key], exact: true });

  await page.goto("/");
  await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
  await page.getByLabel("Password").fill(LOGIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Intake" })
    .click();
  await expect(page.getByRole("heading", { name: "Your job search" })).toBeVisible();

  await test.step("the form is pre-filled, with how sure and why", async () => {
    for (const key of CORE_KEYS) {
      if (answers[key].values.length === 0) {
        await expect(card(key).getByText("Not enough evidence")).toBeVisible();
        continue;
      }
      await expect(card(key).getByText(/^(High|Medium|Low) confidence$/)).toBeVisible();
      await expect(card(key).getByText(/^(from|in) (\d+|one) /)).toBeVisible();
      for (const chip of chips(key)) {
        await expect(
          card(key).getByRole("button", { name: `Remove ${chip}`, exact: true }),
        ).toBeVisible();
      }
    }
    for (const { label } of expected.profile.extraQuestions) {
      // Found by the model once the form is asked for (intake.v1), so they may come a little later.
      await expect(page.getByRole("region", { name: label, exact: true })).toBeVisible({
        timeout: 60_000,
      });
    }
  });

  await test.step("the evidence for minimum pay opens the linked messages", async () => {
    const evidence = answers.min_pay.evidence;
    await card("min_pay")
      .getByRole("button", {
        name: evidence.length === 1 ? "Show the email" : `Show the ${evidence.length} emails`,
      })
      .click();
    const links = page.getByRole("list", { name: "Evidence for Minimum pay" }).getByRole("link");
    await expect(links).toHaveCount(Math.min(evidence.length, 10));
    // The subjects load as the list opens; then the first one opens in the job inbox.
    await expect(links.first()).not.toHaveText(/^Email \d+$/);
    const subject = (await links.first().innerText()).replace(/^Your reply: /, "");
    await links.first().click();
    await expect(page.getByRole("heading", { name: subject, level: 2 })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Your job search" })).toBeVisible();
  });

  const amsterdam = chips("places").find((chip) => chip.startsWith("Amsterdam"));
  await test.step("she removes Amsterdam with a click", async () => {
    expect(amsterdam, "Maria's expected places name Amsterdam").toBeDefined();
    await card("places")
      .getByRole("button", { name: `Remove ${amsterdam}`, exact: true })
      .click();
    await expect(card("places").getByText("Set by you")).toBeVisible();
    await expect(card("places")).not.toContainText("Amsterdam");
    for (const chip of chips("places").filter((c) => c !== amsterdam)) {
      await expect(
        card("places").getByRole("button", { name: `Remove ${chip}`, exact: true }),
      ).toBeVisible();
    }
  });

  await test.step("Confirm saves the profile, every entry with its source", async () => {
    const confirm = page.getByRole("button", { name: "Confirm" });
    await expect(confirm).toBeEnabled({ timeout: 60_000 });
    await confirm.click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("heading", { name: "My job search", level: 1 })).toBeVisible();
    for (const key of CORE_KEYS) {
      const source = key === "places" ? "Set by you" : "From the scan";
      await expect(card(key).getByText(source, { exact: true })).toBeVisible();
    }
    await expect(card("places")).not.toContainText("Amsterdam");
  });

  await test.step("logs", async () => {
    await expect.poll(() => eventsSince(mark)).toContain("intake.confirmed");
  });
});
