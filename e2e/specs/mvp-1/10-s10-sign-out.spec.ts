import { type APIRequestContext, expect, test } from "@playwright/test";
import { PERSONA_ADDRESSES } from "../../fixtures/format.ts";

// S10 of docs/mvp/MVP-1.md: sign-out (F1.2, F1.4). The probes sign in with sessions of their own.

const LOGIN = "E2E-SECRET-maria-login";

async function sessionCookie(api: APIRequestContext): Promise<string> {
  const { cookies } = await api.storageState();
  const value = cookies.find((c) => c.name === "jf_session")?.value;
  if (!value) throw new Error("no jf_session cookie");
  return value;
}

test("S10: sign-out", async ({ page, playwright, baseURL }) => {
  const signIn = async () => {
    await page.getByLabel("Email").fill(PERSONA_ADDRESSES.maria);
    await page.getByLabel("Password").fill(LOGIN);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Job inbox" })).toBeVisible();
  };
  await page.goto("/");
  await signIn();

  await test.step("Maria signs out; Back shows no workspace data", async () => {
    // A page of hers to go back to: Sign out replaces the one it was pressed on.
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Profile" })
      .click();
    await expect(page.getByRole("heading", { name: "My job search" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Job inbox" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Messages" })).toHaveCount(0);
    await expect(page.getByLabel("Workspace")).toHaveCount(0);
  });

  await test.step("she signs in again", async () => {
    await signIn();
  });

  await test.step("probes: a new session id per sign-in; a signed-out cookie gets 401", async () => {
    const origin = new URL(baseURL ?? "http://127.0.0.1:8080").origin;
    const contexts = await Promise.all(
      [1, 2].map(() =>
        playwright.request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } }),
      ),
    );
    const bare = await playwright.request.newContext({ baseURL: origin });
    try {
      const cookies: string[] = [];
      for (const api of contexts) {
        const response = await api.post("/api/auth/sign-in", {
          data: { email: PERSONA_ADDRESSES.maria, password: LOGIN },
        });
        expect(response.status()).toBe(200);
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
