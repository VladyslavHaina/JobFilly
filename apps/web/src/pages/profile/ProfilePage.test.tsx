import type { CurrentScan, Profile, ProfileEntry, Role } from "@jobfilly/schema";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  json,
  renderApp,
  TEST_USER,
  testWorkspace,
} from "../../components/testing";
import { paths } from "../../paths";

// The profile page inside the app's own routes, against a fake API (F6.5, F6.7).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AT = "2026-10-01T10:05:00.000Z";

const entry = (overrides: Partial<ProfileEntry> & Pick<ProfileEntry, "key" | "label">) =>
  ({
    value: [],
    confidence: null,
    evidence: [],
    source: "scan",
    updatedAt: AT,
    updatedBy: null,
    ...overrides,
  }) as ProfileEntry;

const PROFILE: Profile = {
  id: "00000000-0000-4000-8000-0000000000f1",
  workspaceId: testWorkspace().id,
  name: "My job search",
  confirmedAt: AT,
  entries: [
    entry({
      key: "places",
      label: "Places you'd work onsite or hybrid",
      value: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
      source: "you",
      updatedBy: TEST_USER.id,
      evidence: [{ messageId: "<r1@inbox.example>", reason: "from 2 of your replies" }],
    }),
    entry({
      key: "contracts",
      label: "Contracts",
      value: ["permanent", "B2B"],
      confidence: "high",
    }),
    entry({ key: "deal_breakers", label: "Deal-breakers" }),
    entry({
      key: "extra.relocation",
      label: "Would you relocate within the EU?",
      value: ["Yes"],
      source: "you",
    }),
  ],
};

const scanState = (status: "running" | "stopped" | null): CurrentScan => ({
  progress: status && {
    scanId: "00000000-0000-4000-8000-0000000000c1",
    kind: "first",
    status,
    stopReason: status === "stopped" ? "confident" : null,
    handledWithoutAi: 300,
    likely: 260,
    analyzed: 40,
    jobFound: 35,
    answersFirm: 5,
    notAnalyzed: 220,
    calls: 40,
    tokens: 12000,
  },
  stopMessage: status === "stopped" ? "Stopped: confident after 40 of 260 likely job emails" : null,
  stoppedAt: status === "stopped" ? "2026-10-01T10:30:00.000Z" : null,
  totalTokens: status ? 12000 : 0,
});

function profileApi(
  options: { role?: Role; profiles?: Profile[]; scan?: "running" | "stopped" | null } = {},
) {
  const ws = testWorkspace({ role: options.role ?? "editor" });
  let profiles = structuredClone(options.profiles ?? [PROFILE]);
  const requests = fakeApi({
    "GET /api/auth/session": { user: TEST_USER },
    "GET /api/workspaces": { items: [ws] },
    "GET /api/invites": { items: [] },
    "GET /api/workspaces/:id/scans/current": scanState(
      options.scan === undefined ? "stopped" : options.scan,
    ),
    "GET /api/workspaces/:id/profiles": () => ({ items: profiles }),
    "PATCH /api/workspaces/:id/profiles/:profileId": (req: FakeRequest) => {
      const patch = req.body as { name?: string; entries?: { key: string; value: unknown }[] };
      const current = profiles[0] as Profile;
      const updated: Profile = {
        ...current,
        name: patch.name ?? current.name,
        entries: current.entries.map((e) => {
          const change = patch.entries?.find((c) => c.key === e.key);
          return change
            ? ({
                ...e,
                value: change.value,
                source: "you",
                updatedBy: TEST_USER.id,
              } as ProfileEntry)
            : e;
        }),
      };
      profiles = [updated];
      // MVP 3 (F2.3): with how many roles the change changes.
      return { ...updated, changed: 0 };
    },
  });
  return { ws, requests };
}

const section = (label: string) => screen.findByRole("region", { name: label });

describe("the profile page (F6.5)", () => {
  it("shows every entry with its source", async () => {
    const { ws } = profileApi();
    renderApp(paths.profile(ws.id));
    expect(await screen.findByRole("heading", { name: "My job search" })).toBeTruthy();
    const places = within(await section("Places you'd work onsite or hybrid"));
    expect(places.getByText("Set by you")).toBeTruthy();
    expect(places.getByText("Berlin, Germany (hybrid)")).toBeTruthy();
    expect(places.getByRole("button", { name: "Show the email" })).toBeTruthy();
    const contracts = within(await section("Contracts"));
    expect(contracts.getByText("From the scan")).toBeTruthy();
    expect(contracts.getByText("permanent")).toBeTruthy();
    const dealBreakers = within(await section("Deal-breakers"));
    expect(dealBreakers.getByText("No answer yet.")).toBeTruthy();
    const extra = within(await section("Would you relocate within the EU?"));
    expect(extra.getByText("Set by you")).toBeTruthy();
    expect(extra.getByText("Yes")).toBeTruthy();
  });

  it("can be renamed", async () => {
    const { ws, requests } = profileApi();
    renderApp(paths.profile(ws.id));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rename" }));
    const name = screen.getByLabelText("Profile name");
    expect(name).toHaveProperty("value", "My job search");
    await user.clear(name);
    await user.type(name, "Remote EU");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Remote EU" })).toBeTruthy();
    expect(requests.find((r) => r.method === "PATCH")).toMatchObject({
      path: `/api/workspaces/${ws.id}/profiles/${PROFILE.id}`,
      body: { name: "Remote EU" },
    });
  });

  it("lets an editor change an answer with a click, then shows it as theirs", async () => {
    const { ws, requests } = profileApi();
    renderApp(paths.profile(ws.id));
    const user = userEvent.setup();
    const contracts = within(await section("Contracts"));
    await user.click(contracts.getByRole("button", { name: "Remove permanent" }));
    expect(await contracts.findByText("Set by you")).toBeTruthy();
    expect(contracts.queryByText("permanent")).toBeNull();
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
      entries: [{ key: "contracts", value: ["B2B"] }],
    });
  });

  it("sets a policy number, and shows entries set by a decision or the assistant", async () => {
    const policy = entry({
      key: "reply_threshold",
      label: "Fit score that gets an automatic reply",
      value: [70],
      source: "assistant",
    });
    const decided = entry({ key: "deal_breakers", label: "Deal-breakers", source: "decision" });
    const { ws, requests } = profileApi({
      profiles: [{ ...PROFILE, entries: [policy, decided] }],
    });
    const user = userEvent.setup();
    renderApp(paths.profile(ws.id));
    const threshold = within(await section("Fit score that gets an automatic reply"));
    expect(threshold.getByText("From the assistant")).toBeTruthy();
    expect(within(await section("Deal-breakers")).getByText("From a decision")).toBeTruthy();
    const field = threshold.getByLabelText("Fit score that gets an automatic reply");
    await user.clear(field);
    await user.type(field, "80");
    await user.click(threshold.getByRole("button", { name: "Save" }));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
      entries: [{ key: "reply_threshold", value: [80] }],
    });
  });

  it("points to the intake form when nothing is confirmed yet", async () => {
    const { ws } = profileApi({ profiles: [] });
    renderApp(paths.profile(ws.id));
    expect(
      (await screen.findByRole("link", { name: "Open the intake form" })).getAttribute("href"),
    ).toBe(paths.intake(ws.id));
    expect(screen.getByText("confirm them to save it.", { exact: false })).toBeTruthy();
  });
});

describe("before there is a profile (S4)", () => {
  it("tells a viewer who confirms the intake form, and lets them see it", async () => {
    const { ws } = profileApi({ profiles: [], role: "viewer" });
    renderApp(paths.profile(ws.id));
    expect(
      (await screen.findByRole("link", { name: "See the intake form" })).getAttribute("href"),
    ).toBe(paths.intake(ws.id));
    expect(
      screen.getByText("It is saved when an editor or admin confirms the intake form.", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open the intake form" })).toBeNull();
  });

  it("while the first scan runs, says why and links to the scan", async () => {
    const { ws } = profileApi({ profiles: [], scan: "running" });
    renderApp(paths.profile(ws.id));
    expect((await screen.findByRole("link", { name: "Go to the scan" })).getAttribute("href")).toBe(
      paths.scan(ws.id),
    );
    expect(
      screen.getByText("the form fills itself in once the first scan has stopped.", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open the intake form" })).toBeNull();
  });

  it("before any scan, sends an admin to start it and tells the others who does", async () => {
    const admin = profileApi({ profiles: [], scan: null, role: "admin" });
    renderApp(paths.profile(admin.ws.id));
    expect(
      (await screen.findByRole("link", { name: "Start the first scan" })).getAttribute("href"),
    ).toBe(paths.scan(admin.ws.id));
    cleanup();
    vi.unstubAllGlobals();

    const viewer = profileApi({ profiles: [], scan: null, role: "viewer" });
    renderApp(paths.profile(viewer.ws.id));
    expect((await screen.findByRole("link", { name: "See the scan" })).getAttribute("href")).toBe(
      paths.scan(viewer.ws.id),
    );
    expect(
      screen.getByText("An admin of this workspace starts it.", { exact: false }),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Start the first scan" })).toBeNull();
  });
});

describe("for viewers (F6.7)", () => {
  it("shows the profile but nothing can be changed", async () => {
    const { ws, requests } = profileApi({ role: "viewer" });
    renderApp(paths.profile(ws.id));
    expect(
      await screen.findByText("You can see the profile; only editors and admins can change it."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename" })).toHaveProperty("disabled", true);
    for (const label of PROFILE.entries.map((e) => e.label)) {
      const s = within(await section(label));
      for (const button of s.getAllByRole("button")) {
        if (/^(Show|Hide) the/.test(button.textContent ?? "")) continue;
        expect(button, `${label}: ${button.textContent}`).toHaveProperty("disabled", true);
      }
    }
    const user = userEvent.setup();
    await user.click(
      within(await section("Contracts")).getByRole("button", { name: "Remove permanent" }),
    );
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(screen.getByRole("switch", { name: "Give roles to this profile" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("button", { name: "Re-run setup" })).toBeNull();
  });
});

describe("several profiles (MVP 3, F1.1, F1.2, F2.3)", () => {
  const GERMANY: Profile = {
    ...PROFILE,
    id: "00000000-0000-4000-8000-0000000000f2",
    name: "Germany permanent",
    enabled: true,
  };

  function severalApi(role: Role = "admin") {
    const ws = testWorkspace({ role });
    let profiles: Profile[] = [{ ...PROFILE, name: "Remote EU", enabled: true }, GERMANY];
    const requests = fakeApi({
      "GET /api/auth/session": { user: TEST_USER },
      "GET /api/workspaces": { items: [ws] },
      "GET /api/invites": { items: [] },
      "GET /api/workspaces/:id/scans/current": scanState("stopped"),
      "GET /api/workspaces/:id/profiles": () => ({ items: profiles }),
      "PATCH /api/workspaces/:id/profiles/:profileId": (
        req: FakeRequest,
        p: Record<string, string>,
      ) => {
        const patch = req.body as { enabled?: boolean };
        const others = profiles.filter((x) => x.id !== p.profileId && x.enabled !== false);
        if (patch.enabled === false && others.length === 0) {
          return json({ error: "last_on", message: "At least one profile stays on." }, 409);
        }
        profiles = profiles.map((x) =>
          x.id === p.profileId && patch.enabled !== undefined
            ? { ...x, enabled: patch.enabled }
            : x,
        );
        const updated = profiles.find((x) => x.id === p.profileId) as Profile;
        return { ...updated, changed: patch.enabled === undefined ? 3 : 0 };
      },
      "POST /api/workspaces/:id/scans": json(scanState("running"), 201),
    });
    return { ws, requests };
  }

  it("switches between profiles, and switches one off but not the last one on", async () => {
    const { ws, requests } = severalApi("editor");
    const { router } = renderApp(paths.profile(ws.id));
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Remote EU" })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Profile"), "Germany permanent");
    expect(await screen.findByRole("heading", { name: "Germany permanent" })).toBeTruthy();
    expect(router.state.location.search).toBe(`?profile=${GERMANY.id}`);

    await user.click(screen.getByRole("switch", { name: "Give roles to this profile" }));
    expect(await screen.findByText("Off: it gets no roles")).toBeTruthy();
    expect(requests.find((r) => r.method === "PATCH")).toMatchObject({
      path: `/api/workspaces/${ws.id}/profiles/${GERMANY.id}`,
      body: { enabled: false },
    });
    expect(screen.getByRole("option", { name: "Germany permanent (off)" })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Profile"), "Remote EU");
    await user.click(await screen.findByRole("switch", { name: "Give roles to this profile" }));
    expect(await screen.findByText("At least one profile stays on.")).toBeTruthy();
  });

  it("says how many roles a changed answer changes", async () => {
    const { ws } = severalApi("editor");
    renderApp(paths.profile(ws.id));
    const user = userEvent.setup();
    const contracts = within(await section("Contracts"));
    await user.click(contracts.getByRole("button", { name: "Remove permanent" }));
    expect(
      await screen.findByText("Saved. It changes 3 roles; your inbox shows them within a minute."),
    ).toBeTruthy();
  });

  it("lets an admin re-run setup with a hint, then shows the scan", async () => {
    const { ws, requests } = severalApi("admin");
    const { router } = renderApp(paths.profile(ws.id));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Re-run setup" }));
    await user.type(
      screen.getByLabelText("What changed? (optional)"),
      "I've moved to Germany, permanent roles only",
    );
    await user.click(screen.getByRole("button", { name: "Start the re-run" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.scan(ws.id)));
    expect(requests.find((r) => r.method === "POST")).toMatchObject({
      path: `/api/workspaces/${ws.id}/scans`,
      body: { kind: "rerun", hint: "I've moved to Germany, permanent roles only" },
    });
  });

  it("offers no re-run to an editor", async () => {
    const { ws } = severalApi("editor");
    renderApp(paths.profile(ws.id));
    expect(await screen.findByRole("heading", { name: "Remote EU" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Re-run setup" })).toBeNull();
  });
});
