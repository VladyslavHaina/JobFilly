import { AI_PROVIDERS, type AiSettingsPublic, aiProvider } from "@jobfilly/schema";
import { cleanup, screen } from "@testing-library/react";
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

// AiForm in onboarding and settings mode, against a fake API (F3.1–F3.3).

const ws = testWorkspace();
const url = `/api/workspaces/${ws.id}/ai`;
const KEY = "E2E-SECRET-ai-key";

const saved: AiSettingsPublic = {
  provider: "openai-compatible",
  baseUrl: "http://fake-ai:8080/v1",
  models: { classify: "m-c", extract: "m-e", prefs: "m-p", intake: "m-i" },
  budgetPerRun: 300,
  hasKey: true,
  readBy: { provider: "OpenAI-compatible endpoint", host: "fake-ai:8080" },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const modelFields = () =>
  ["sorting mail", "job facts", "your preferences", "extra questions"].map(
    (t) => (screen.getByLabelText(`Model for ${t}`) as HTMLInputElement).value,
  );

async function pickCompatible(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText("AI provider"),
    "OpenAI-compatible endpoint",
  );
  await user.type(screen.getByLabelText("Base URL"), "http://fake-ai:8080/v1");
  await user.type(screen.getByLabelText("API key (optional)"), KEY);
}

describe.each(["onboarding", "settings"] as const)("AiForm in %s mode", (mode) => {
  it("offers the short list of providers", async () => {
    fakeApi({ [`GET ${url}`]: { settings: null } });
    renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    const select = await screen.findByLabelText("AI provider");
    const options = [...select.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Choose a provider", ...AI_PROVIDERS.map((p) => p.label)]);
    expect(options).toHaveLength(5);
  });

  it("pre-selects the provider's default models, which can be changed", async () => {
    const seen = fakeApi({
      [`GET ${url}`]: { settings: null },
      [`PUT ${url}`]: (req: FakeRequest) => ({
        settings: { ...saved, models: (req.body as AiSettingsPublic).models },
      }),
    });
    const user = userEvent.setup();
    renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    await user.selectOptions(await screen.findByLabelText("AI provider"), "Anthropic");
    const d = aiProvider("anthropic").defaultModels;
    expect(modelFields()).toEqual([d.classify, d.extract, d.prefs, d.intake]);
    await user.selectOptions(screen.getByLabelText("AI provider"), "Google");
    expect(modelFields()[0]).toBe(aiProvider("google").defaultModels.classify);
    const field = screen.getByLabelText("Model for job facts");
    await user.clear(field);
    await user.type(field, "my-own-model");
    await user.type(screen.getByLabelText("API key"), KEY);
    await user.click(screen.getByRole("button", { name: /^Save/ }));
    await vi.waitFor(() => expect(seen.some((r) => r.method === "PUT")).toBe(true));
    expect(seen.find((r) => r.method === "PUT")?.body).toMatchObject({
      provider: "google",
      models: { extract: "my-own-model", classify: aiProvider("google").defaultModels.classify },
    });
  });

  it("has key and base URL fields and the budget, 300 by default", async () => {
    fakeApi({ [`GET ${url}`]: { settings: null } });
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
    fakeApi({ [`GET ${url}`]: { settings: null } });
    const user = userEvent.setup();
    const { container } = renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    await user.selectOptions(await screen.findByLabelText("AI provider"), "Anthropic");
    expect(screen.getByText("Your mail is read by Anthropic (api.anthropic.com)")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("AI provider"), "OpenAI-compatible endpoint");
    await user.type(screen.getByLabelText("Base URL"), "http://fake-ai:8080/v1");
    expect(
      screen.getByText("Your mail is read by OpenAI-compatible endpoint (fake-ai:8080)"),
    ).toBeTruthy();
    expect(container.textContent?.match(/Your mail is read by/g)).toHaveLength(1);
    expect(container.textContent).not.toMatch(/price|cost|\$|per token|privacy policy/i);
  });

  it("tests with a waiting state, then success", async () => {
    let answer: (r: Response) => void = () => {};
    const seen = fakeApi({
      [`GET ${url}`]: { settings: null },
      [`POST ${url}/test`]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    const user = userEvent.setup();
    renderInWorkspace(<AiForm workspaceId={ws.id} mode={mode} />);
    await pickCompatible(user);
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Waiting for the AI to answer…")).toBeTruthy();
    answer(json({ ok: true }));
    expect(await screen.findByText("Test succeeded: the AI answered.")).toBeTruthy();
    expect(seen.find((r) => r.method === "POST")?.body).toEqual({
      provider: "openai-compatible",
      baseUrl: "http://fake-ai:8080/v1",
      models: aiProvider("openai-compatible").defaultModels,
      apiKey: KEY,
      budgetPerRun: 300,
    });
  });

  it("shows a plain error when the test fails", async () => {
    fakeApi({
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
    fakeApi({ [`GET ${url}`]: { settings: null }, [`PUT ${url}`]: { settings: saved } });
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
    fakeApi({ [`GET ${url}`]: { settings: { ...saved, budgetPerRun: 5 } } });
    const { container } = renderInWorkspace(<AiForm workspaceId={ws.id} mode="settings" />);
    expect(((await screen.findByLabelText("AI provider")) as HTMLSelectElement).value).toBe(
      "openai-compatible",
    );
    expect(modelFields()).toEqual(["m-c", "m-e", "m-p", "m-i"]);
    expect((screen.getByLabelText("Model calls per scan run") as HTMLInputElement).value).toBe("5");
    expect(screen.getByText("A key is stored. Leave this empty to keep it.")).toBeTruthy();
    expect((screen.getByLabelText("API key (optional)") as HTMLInputElement).value).toBe("");
    expect(container.textContent).not.toContain(KEY);
  });

  it("are read-only for viewers", async () => {
    fakeApi({ [`GET ${url}`]: { settings: saved } });
    renderInWorkspace(<AiForm workspaceId={ws.id} mode="settings" />, { role: "viewer" });
    // Disabled through its fieldset, as every field of the form is.
    expect((await screen.findByLabelText("AI provider")).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText("Model for job facts").matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });
});
