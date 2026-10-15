import type { Profile } from "@jobfilly/schema";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeApi, renderApp, TEST_USER, testWorkspace } from "../../components/testing";
import { paths } from "../../paths";

// The profile page renders the slices' slots for its profile: the CV prompt, the Rules list and
// the profile history. The slots are probes here.

vi.mock("../cvs", async (original) => ({
  ...(await original<object>()),
  ProfileCvPrompt: (p: { profileId: string }) => <p>{`cv prompt ${p.profileId}`}</p>,
}));
vi.mock("../rules", () => ({
  RulesList: (p: { profileId: string }) => <p>{`rules ${p.profileId}`}</p>,
}));
vi.mock("../assistant", async (original) => ({
  ...(await original<object>()),
  ProfileHistory: (p: { profileId: string }) => <p>{`history ${p.profileId}`}</p>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ws = testWorkspace();
const PROFILE: Profile = {
  id: "00000000-0000-4000-8000-0000000000f1",
  workspaceId: ws.id,
  name: "My job search",
  confirmedAt: "2026-10-01T10:05:00.000Z",
  entries: [],
};

describe("the profile page's slots", () => {
  it("passes the profile to the CV prompt, the rules and the history", async () => {
    fakeApi({
      "GET /api/auth/session": { user: TEST_USER },
      "GET /api/workspaces": { items: [ws] },
      "GET /api/invites": { items: [] },
      "GET /api/workspaces/:id/profiles": { items: [PROFILE] },
    });
    renderApp(paths.profile(ws.id));
    expect(await screen.findByText(`cv prompt ${PROFILE.id}`)).toBeTruthy();
    expect(screen.getByText(`rules ${PROFILE.id}`)).toBeTruthy();
    expect(screen.getByText(`history ${PROFILE.id}`)).toBeTruthy();
  });
});
