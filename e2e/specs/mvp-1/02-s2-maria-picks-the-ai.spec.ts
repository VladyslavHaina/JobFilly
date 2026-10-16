import { expect, test } from "@playwright/test";
import {
  AI_KEY,
  apiContext,
  apiSignIn,
  eventsSince,
  FAKE_AI_URL,
  logMark,
  openSettingsTab,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S2 of docs/mvp/MVP-1.md: Maria picks the AI (F3.1–F3.3, F1.10). Every spec has a browser of
// its own, and a person types no address but the start URL, so the onboarding step S1 left her
// on can't be reopened: she signs in, lands in the job inbox (her mailbox is connected) and picks
// the AI where the app offers it then, Main nav › Settings › AI, the same form. She continues to
// the scan through the Main nav, where S3 starts.

test("S2: Maria picks the AI", async ({ page, playwright, baseURL }) => {
  const mark = logMark();
  const main = page.getByRole("navigation", { name: "Main", exact: true });

  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  await openSettingsTab(page, "AI");
  await expect(page.getByRole("form", { name: "Pick your AI", exact: true })).toBeVisible();

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

  await test.step("she saves and continues to the scan", async () => {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await main.getByRole("link", { name: "Scan", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Scan", level: 1, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start scan", exact: true })).toBeVisible();
  });

  await test.step("probes: no key in the settings, and foreign writes refused", async () => {
    const api = await apiContext(playwright.request, baseURL);
    try {
      await apiSignIn(api, "maria");

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
        baseURL: new URL(page.url()).origin,
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
