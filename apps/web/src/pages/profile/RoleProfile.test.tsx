import type { Profile, Role, RoleProfile as RoleProfileValue } from "@jobfilly/schema";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { RoleProfile } from "./RoleProfile";

// The role's profile on the message detail (MVP 3, F1.3): the profile with why, and for editors
// a choice among the profiles that are on, sent as the role's profile.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WS = testWorkspace().id;
const MESSAGE = "<munich@agency.example>";
const profile = (id: string, name: string, enabled = true): Profile => ({
  id,
  workspaceId: WS,
  name,
  entries: [],
  confirmedAt: "2026-10-01T10:00:00.000Z",
  enabled,
});
const REMOTE = profile("00000000-0000-4000-8000-0000000000f1", "Remote EU");
const GERMANY = profile("00000000-0000-4000-8000-0000000000f2", "Germany permanent");
const OLD = profile("00000000-0000-4000-8000-0000000000f3", "Old search", false);

const ASSIGNED: RoleProfileValue = {
  profileId: GERMANY.id,
  name: GERMANY.name,
  reason: "Munich role, German, permanent → 'Germany permanent'",
  source: "auto",
};

function setup(role: Role, profiles: Profile[] = [REMOTE, GERMANY, OLD]) {
  const requests = fakeApi({
    "GET /api/workspaces/:ws/profiles": { items: profiles },
    "PUT /api/workspaces/:ws/messages/:id/roles/:position/profile": (req: FakeRequest) => {
      const { profileId } = req.body as { profileId: string };
      const chosen = profiles.find((p) => p.id === profileId) as Profile;
      return {
        profileId,
        name: chosen.name,
        reason: `Chosen by hand → '${chosen.name}'`,
        source: "you",
      };
    },
  });
  renderInWorkspace(
    <RoleProfile workspaceId={WS} messageId={MESSAGE} position={0} profile={ASSIGNED} />,
    { role },
  );
  return requests;
}

describe("RoleProfile", () => {
  it("shows the role's profile with why, and lets an editor put it in another one", async () => {
    const requests = setup("editor");
    expect(screen.getByText("Munich role, German, permanent → 'Germany permanent'")).toBeTruthy();
    const select = await screen.findByLabelText("Put role 1 in another profile");
    // Only the profiles that are on are offered.
    expect(screen.queryByRole("option", { name: "Old search" })).toBeNull();
    await userEvent.setup().selectOptions(select, "Remote EU");
    expect(await screen.findByText("Chosen by hand → 'Remote EU'")).toBeTruthy();
    expect(requests.find((r) => r.method === "PUT")).toMatchObject({
      path: `/api/workspaces/${WS}/messages/${encodeURIComponent(MESSAGE)}/roles/0/profile`,
      body: { profileId: REMOTE.id },
    });
  });

  it("only shows the profile to a viewer, and offers no choice with one profile on", async () => {
    setup("viewer");
    expect(screen.getByText("Munich role, German, permanent → 'Germany permanent'")).toBeTruthy();
    expect(screen.queryByLabelText("Put role 1 in another profile")).toBeNull();
    cleanup();
    setup("editor", [GERMANY, OLD]);
    await screen.findByText("Munich role, German, permanent → 'Germany permanent'");
    expect(screen.queryByLabelText("Put role 1 in another profile")).toBeNull();
  });
});
