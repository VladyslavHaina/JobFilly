import { type APIRequestContext, expect, test } from "@playwright/test";
import { apiContext, apiSignIn, signIn, submitSignIn } from "../shared.ts";

// S10 of docs/mvp/MVP-1.md: sign-out (F1.2, F1.4). The probes sign in with sessions of their own.

async function sessionCookie(api: APIRequestContext): Promise<string> {
  const { cookies } = await api.storageState();
  const value = cookies.find((c) => c.name === "jf_session")?.value;
  if (!value) throw new Error("no jf_session cookie");
  return value;
}

test("S10: sign-out", async ({ page, playwright, baseURL }) => {
  const inbox = page.getByRole("heading", { name: "Job inbox", exact: true });
  await signIn(page, "maria");
  await expect(inbox).toBeVisible();

  await test.step("Maria signs out; Back shows no workspace data", async () => {
    // A page of hers to go back to: Sign out replaces the one it was pressed on.
    await page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: "Profile", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "My job search", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await expect(inbox).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Messages", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Workspace")).toHaveCount(0);
  });

  await test.step("she signs in again", async () => {
    await submitSignIn(page, "maria");
    await expect(inbox).toBeVisible();
  });

  await test.step("probes: a new session id per sign-in; a signed-out cookie gets 401", async () => {
    const contexts = await Promise.all([1, 2].map(() => apiContext(playwright.request, baseURL)));
    const bare = await playwright.request.newContext({ baseURL });
    try {
      const cookies: string[] = [];
      for (const api of contexts) {
        await apiSignIn(api, "maria");
        cookies.push(await sessionCookie(api));
      }
      expect(cookies[0]).not.toBe(cookies[1]);

      const [first] = contexts;
      const cookie = `jf_session=${cookies[0]}`;
      expect((await bare.get("/api/auth/me", { headers: { Cookie: cookie } })).status()).toBe(200);
      expect((await first?.post("/api/auth/sign-out"))?.status()).toBe(204);
      expect((await bare.get("/api/auth/me", { headers: { Cookie: cookie } })).status()).toBe(401);
      // The other session is untouched.
      expect((await contexts[1]?.get("/api/auth/me"))?.status()).toBe(200);
    } finally {
      await Promise.all([...contexts, bare].map((api) => api.dispose()));
    }
  });
});
