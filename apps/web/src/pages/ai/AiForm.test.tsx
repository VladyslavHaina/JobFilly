import type { AiProvider, AiProviderId, AiSettingsPublic } from "@jobfilly/schema";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  json,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { AiForm } from "./AiForm";

// AiForm in onboarding and settings mode, against a fake API (F3.1–F3.3). The provider list is
// whatever GET /ai/providers serves; these models and hosts are the fake server's, so a form that
// carried its own catalogue would fail here.

const ws = testWorkspace();
const url = `/api/workspaces/${ws.id}/ai`;
const KEY = "E2E-SECRET-ai-key";

const models = (prefix: string) => ({
  classify: `${prefix}-classify`,
  extract: `${prefix}-extract`,
  prefs: `${prefix}-prefs`,
  intake: `${prefix}-intake`,
  cv: `${prefix}-cv`,
  match: `${prefix}-match`,
  draft: `${prefix}-draft`,
  assistant: `${prefix}-assistant`,
});
const vendor = (id: AiProviderId, label: string, defaultHost: string): AiProvider => ({
  id,
  label,
  defaultHost,
  keyRequired: true,
  baseUrlRequired: false,
  defaultModels: models(id),
});
const providers: AiProvider[] = [
  vendor("anthropic", "Anthropic", "api.anthropic.test"),
  vendor("openai", "OpenAI", "api.openai.test"),
  vendor("google", "Google", "google-ai.test"),
  {
    id: "openai-compatible",
    label: "OpenAI-compatible endpoint",
    defaultHost: null,
    keyRequired: false,
    baseUrlRequired: true,
    defaultModels: models("local"),
  },
];
const defaults = (id: AiProviderId) => providers.find((p) => p.id === id)?.defaultModels;

/** The fake API with the provider list served, as the server serves it to every member. */
const api = (routes: Parameters<typeof fakeApi>[0]) =>
  fakeApi({ [`GET ${url}/providers`]: { items: providers }, ...routes });

const saved: AiSettingsPublic = {
  provider: "openai-compatible",
  baseUrl: "http://fake-ai:8080/v1",
  models: {
    classify: "m-c",
    extract: "m-e",
    prefs: "m-p",
    intake: "m-i",
    cv: "m-cv",
    match: "m-m",
    draft: "m-d",
    assistant: "m-a",
  },
  budgetPerRun: 300,
  hasKey: true,
  readBy: { provider: "OpenAI-compatible endpoint", host: "fake-ai:8080" },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const modelFields = () =>
  [
    "sorting mail",
    "job facts",
    "your preferences",
    "extra questions",
    "reading CVs",
    "matching roles",
    "reply drafts",
    "the assistant",
  ].map((t) => (screen.getByLabelText(`Model for ${t}`) as HTMLInputElement).value);

async function pickCompatible(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText("AI provider"),
    "OpenAI-compatible endpoint",
  );
  await user.type(screen.getByLabelText("Base URL"), "http://fake-ai:8080/v1");
  await user.type(screen.getByLabelText("API key (optional)"), KEY);
}

describe.each(["onboarding", "settings"] as const)("AiForm in %s mode", (mode) => {
  it("offers the short list of providers the server serves", async () => {
    api({ [`GET ${url}`]: { settings: null } });
    renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    const select = await screen.findByLabelText("AI provider");
    const options = [...select.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Choose a provider", ...providers.map((p) => p.label)]);
    expect(options).toHaveLength(5);
  });

  it("says so when the provider list can't be loaded", async () => {
    fakeApi({
      [`GET ${url}`]: { settings: null },
      [`GET ${url}/providers`]: json({ error: "internal", message: "Something went wrong" }, 500),
    });
    renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong");
    expect(screen.queryByLabelText("AI provider")).toBeNull();
  });

  it("pre-selects the provider's default models, which can be changed", async () => {
    const seen = api({
      [`GET ${url}`]: { settings: null },
      [`PUT ${url}`]: (req: FakeRequest) => ({
        settings: { ...saved, models: (req.body as AiSettingsPublic).models },
      }),
    });
    const user = userEvent.setup();
    renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    await user.selectOptions(await screen.findByLabelText("AI provider"), "Anthropic");
    expect(modelFields()).toEqual([
      "anthropic-classify",
      "anthropic-extract",
      "anthropic-prefs",
      "anthropic-intake",
      "anthropic-cv",
      "anthropic-match",
      "anthropic-draft",
      "anthropic-assistant",
    ]);
    await user.selectOptions(screen.getByLabelText("AI provider"), "Google");
    expect(modelFields()[0]).toBe("google-classify");
    const field = screen.getByLabelText("Model for job facts");
    await user.clear(field);
    await user.type(field, "my-own-model");
    await user.type(screen.getByLabelText("API key"), KEY);
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await vi.waitFor(() => expect(seen.some((r) => r.method === "PUT")).toBe(true));
    expect(seen.find((r) => r.method === "PUT")?.body).toMatchObject({
      provider: "google",
      models: { extract: "my-own-model", classify: "google-classify" },
    });
  });

  it("has key and base URL fields and the budget, 300 by default", async () => {
    api({ [`GET ${url}`]: { settings: null } });
    const user = userEvent.setup();
    renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    await user.selectOptions(await screen.findByLabelText("AI provider"), "OpenAI");
    expect(screen.getByLabelText("API key").getAttribute("type")).toBe("password");
    expect(screen.getByLabelText("Base URL (optional)")).toBeTruthy();
    expect((screen.getByLabelText("Model calls per scan run") as HTMLInputElement).value).toBe(
      "300",
    );
  });

  it("shows the one privacy line for the chosen provider and host, and nothing about prices", async () => {
    api({ [`GET ${url}`]: { settings: null } });
    const user = userEvent.setup();
    const { container } = renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    await user.selectOptions(await screen.findByLabelText("AI provider"), "Anthropic");
    expect(screen.getByText("Your mail is read by Anthropic (api.anthropic.test)")).toBeTruthy();
    // A base URL replaces the served host, as soon as it has one; its user part is never shown.
    const baseUrl = screen.getByLabelText("Base URL (optional)");
    await user.type(baseUrl, "https://user:E2E-SECRET-x@Proxy.example");
    expect(screen.getByText("Your mail is read by Anthropic (proxy.example)")).toBeTruthy();
    expect(container.textContent).not.toContain("E2E-SECRET-x");
    await user.clear(baseUrl);
    expect(screen.getByText("Your mail is read by Anthropic (api.anthropic.test)")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("AI provider"), "OpenAI-compatible endpoint");
    // No host is known before the endpoint's base URL is typed, so there is no line yet.
    expect(container.textContent).not.toMatch(/Your mail is read by/);
    await user.type(screen.getByLabelText("Base URL"), "http://fake-ai:8080/v1");
    expect(
      screen.getByText("Your mail is read by OpenAI-compatible endpoint (fake-ai:8080)"),
    ).toBeTruthy();
    expect(container.textContent?.match(/Your mail is read by/g)).toHaveLength(1);
    expect(container.textContent).not.toMatch(/price|cost|\$|per token|privacy policy/i);
  });

  it("tests with a waiting state, then success", async () => {
    let answer: (r: Response) => void = () => {};
    const seen = api({
      [`GET ${url}`]: { settings: null },
      [`POST ${url}/test`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const user = userEvent.setup();
    const { queryClient } = renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await pickCompatible(user);
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Waiting for the AI to answer…")).toBeTruthy();
    answer(json({ ok: true }));
    expect(await screen.findByText("Test succeeded: the AI answered.")).toBeTruthy();
    // The test call counts in the model usage, which no live event refreshes.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["w", ws.id, "usage"] }),
    );
    expect(seen.find((r) => r.method === "POST")?.body).toEqual({
      provider: "openai-compatible",
      baseUrl: "http://fake-ai:8080/v1",
      models: defaults("openai-compatible"),
      apiKey: KEY,
      budgetPerRun: 300,
    });
  });

  it("shows a plain error when the test fails", async () => {
    api({
      [`GET ${url}`]: { settings: null },
      [`POST ${url}/test`]: {
        ok: false,
        reason: "unreachable",
        message: "The provider can't be reached",
      },
    });
    const user = userEvent.setup();
    renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    await pickCompatible(user);
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The provider can't be reached",
    );
  });

  it("never shows the key again after saving", async () => {
    const onSaved = vi.fn();
    api({ [`GET ${url}`]: { settings: null }, [`PUT ${url}`]: { settings: saved } });
    const user = userEvent.setup();
    const { container } = renderInWorkspace(
      <AiForm workspaceId={ws.id} mode={mode} onSaved={onSaved} />,
    );
    await pickCompatible(user);
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect((screen.getByLabelText("API key (optional)") as HTMLInputElement).value).toBe("");
    expect(screen.queryByDisplayValue(KEY)).toBeNull();
    expect(container.textContent).not.toContain(KEY);
  });
});

describe("saved settings", () => {
  it("load into the form, say a key is stored, and never show it", async () => {
    api({ [`GET ${url}`]: { settings: { ...saved, budgetPerRun: 5 } } });
    const { container } = renderInWorkspace(<AiForm workspaceId={ws.id} mode="settings" />);
    expect(((await screen.findByLabelText("AI provider")) as HTMLSelectElement).value).toBe(
      "openai-compatible",
    );
    expect(modelFields()).toEqual(["m-c", "m-e", "m-p", "m-i", "m-cv", "m-m", "m-d", "m-a"]);
    expect((screen.getByLabelText("Model calls per scan run") as HTMLInputElement).value).toBe("5");
    expect(screen.getByText("A key is stored. Leave this empty to keep it.")).toBeTruthy();
    expect((screen.getByLabelText("API key (optional)") as HTMLInputElement).value).toBe("");
    expect(container.textContent).not.toContain(KEY);
  });

  it("are read-only for viewers", async () => {
    api({ [`GET ${url}`]: { settings: saved } });
    renderInWorkspace(<AiForm workspaceId={ws.id} mode="settings" />, { role: "viewer" });
    // Disabled through its fieldset, as every field of the form is.
    expect((await screen.findByLabelText("AI provider")).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("Model for job facts").matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });
});
