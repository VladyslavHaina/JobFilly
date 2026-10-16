import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PERSONA_ADDRESSES } from "../../fixtures/format.ts";
import { COMPOSE_FILE, fileState } from "../../stack.ts";

// S2 of docs/mvp/MVP-1.md: Maria picks the AI (F3.1–F3.3, F1.10), the onboarding step S1 left
// her on. Every spec has a browser of its own, so she signs in and comes back to that step by its
// address; "Save and continue" then takes her to the scan, where S3 starts.

const LOGIN = "E2E-SECRET-maria-login";
const AI_KEY = "E2E-SECRET-ai-key";
const FAKE_AI_URL = "http://fake-ai:8080/v1";

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

test("S2: Maria picks the AI", async ({ page, playwright, baseURL }) => {
  const mark = REPLICAS.map((replica) => replicaLog(replica).length);
  const origin = new URL(baseURL ?? "http://127.0.0.1:8080").origin;

  await page.goto("/");
  await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
  await page.getByLabel("Password").fill(LOGIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\//);
  const workspaceId = new URL(page.url()).pathname.split("/")[2] ?? "";
  await page.goto(`/w/${workspaceId}/setup/ai`);
  await expect(page.getByRole("heading", { name: "Pick your AI", level: 1 })).toBeVisible();

  await test.step("an OpenAI-compatible endpoint, tested", async () => {
    await page.getByLabel("AI provider").selectOption({ label: "OpenAI-compatible endpoint" });
    await page.getByLabel("Base URL").fill(FAKE_AI_URL);
    await page.getByLabel("API key (optional)").fill(AI_KEY);
    // A model per task is pre-selected (F3.2).
    await expect(page.getByLabel("Model for sorting mail")).not.toHaveValue("");
    await expect(page.getByLabel("Model for job facts")).not.toHaveValue("");
    await page.getByRole("button", { name: "Test", exact: true }).click();
    await expect(page.getByText("Test succeeded: the AI answered.")).toBeVisible();
    await expect(
      page.getByText(/^Your mail is read by OpenAI-compatible endpoint \(fake-ai(:8080)?\)$/),
    ).toBeVisible();
  });

  await test.step("saving goes on to the scan", async () => {
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("heading", { name: "Start scan", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start scan" })).toBeVisible();
  });

  await test.step("probes: no key in the settings, and foreign writes refused", async () => {
    const api = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    try {
      const signIn = await api.post("/api/auth/sign-in", {
        data: { email: PERSONA_ADDRESSES.maria, password: LOGIN },
      });
      expect(signIn.status()).toBe(200);

      const settings = await api.get(`/api/workspaces/${workspaceId}/ai`);
      expect(settings.status()).toBe(200);
      const text = await settings.text();
      expect(text).not.toContain(AI_KEY);
      const body = JSON.parse(text) as { settings: Record<string, unknown> | null };
      expect(body.settings?.baseUrl).toBe(FAKE_AI_URL);
      expect(Object.keys(body.settings ?? {})).not.toContain("apiKey");

      // Signing out is a state-changing request the probe can afford to have go through.
      const evil = await api.post("/api/auth/sign-out", {
        headers: { Origin: "http://evil.test" },
      });
      expect(evil.status()).toBe(403);
      const bare = await playwright.request.newContext({
        baseURL: origin,
        storageState: await api.storageState(),
      });
      try {
        expect((await bare.post("/api/auth/sign-out")).status()).toBe(403);
      } finally {
        await bare.dispose();
      }
      // Neither went through: the probe's session still works.
      expect((await api.get("/api/auth/me")).status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });

  await test.step("logs", async () => {
    await expect.poll(() => eventsSince(mark)).toContain("ai.settings_saved");
  });
});
