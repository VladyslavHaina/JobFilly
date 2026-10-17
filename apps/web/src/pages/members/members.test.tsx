import type { ActivityList, Member } from "@jobfilly/schema";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  renderInWorkspace,
  TEST_USER,
  testWorkspace,
} from "../../components/testing";
import { AccountPage } from "../account";
import { ActivityPage } from "../activity";
import { DataSettings } from "../data";
import { MembersPage } from "./MembersPage";

// MVP 3's sharing and data pages against a fake API: what a member sees and handing ownership
// over (F6.1, F6.3), the activity log (F9.1), the export and deleting the workspace (F7.1, F7.2),
// and deleting the account (F7.3).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const W = testWorkspace().id;
const TOM = "00000000-0000-4000-8000-000000000002";
const session = { user: TEST_USER };

function members(tom: Partial<Member> = {}): { items: Member[] } {
  return {
    items: [
      {
        userId: TEST_USER.id,
        name: "Maria Santos",
        email: TEST_USER.email,
        role: "admin",
        isOwner: true,
        scope: "everything",
      },
      {
        userId: TOM,
        name: "Tom Okafor",
        email: "tom@inbox.example",
        role: "admin",
        isOwner: false,
        scope: "everything",
        ...tom,
      },
    ],
  };
}

describe("Members (F6.1, F6.3)", () => {
  it("an admin chooses what a member sees, and invites with it", async () => {
    const seen = fakeApi({
      "GET /api/auth/session": session,
      "GET /api/workspaces/:id/members": members(),
      "GET /api/workspaces/:id/invites": { items: [] },
      "PATCH /api/workspaces/:id/members/:userId": members({ scope: "pipeline" }),
    });
    renderInWorkspace(<MembersPage />);
    await userEvent.selectOptions(await screen.findByLabelText("What Tom Okafor sees"), "pipeline");
    expect(seen.find((r) => r.method === "PATCH")).toMatchObject({
      path: `/api/workspaces/${W}/members/${TOM}`,
      body: { scope: "pipeline" },
    });
    // Nobody changes their own row.
    expect(screen.queryByLabelText("Role for Maria Santos")).toBeNull();
    expect(screen.getByLabelText("Sees")).toHaveProperty("value", "everything");
  });

  it("the owner hands the workspace to an admin after confirming", async () => {
    const seen = fakeApi({
      "GET /api/auth/session": session,
      "GET /api/workspaces/:id/members": members(),
      "GET /api/workspaces/:id/invites": { items: [] },
      "POST /api/workspaces/:id/members/:userId/ownership": members({ isOwner: true }),
    });
    renderInWorkspace(<MembersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Make owner" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Make Tom Okafor the owner" }),
    );
    expect(seen.find((r) => r.method === "POST")).toMatchObject({
      path: `/api/workspaces/${W}/members/${TOM}/ownership`,
      body: { confirm: true },
    });
  });

  it("a member who isn't the owner can leave", async () => {
    const seen = fakeApi({
      "GET /api/auth/session": session,
      "GET /api/workspaces/:id/members": {
        items: [{ ...members().items[0], isOwner: false, role: "viewer" }],
      },
      "DELETE /api/workspaces/:id/members/:userId": undefined,
    });
    renderInWorkspace(
      <Routes>
        <Route path="/members" element={<MembersPage />} />
        <Route path="/" element={<p>Home</p>} />
      </Routes>,
      { role: "viewer", workspace: { isOwner: false }, path: "/members" },
    );
    await userEvent.click(await screen.findByRole("button", { name: "Leave workspace" }));
    expect(await screen.findByText("Home")).toBeTruthy();
    expect(seen.find((r) => r.method === "DELETE")?.path).toBe(
      `/api/workspaces/${W}/members/${TEST_USER.id}`,
    );
  });
});

describe("Activity (F9.1)", () => {
  it("lists who did what, and pages back", async () => {
    const page = (id: string, what: string, nextBefore: string | null): ActivityList => ({
      items: [
        {
          id,
          at: "2026-10-16T10:00:00.000Z",
          kind: "member.role_changed",
          actor: { userId: null, name: "Deleted user" },
          target: null,
          what,
          refs: {},
        },
      ],
      nextBefore,
    });
    const older = "00000000-0000-4000-8000-0000000000c1";
    fakeApi({
      "GET /api/workspaces/:id/activity": (req: FakeRequest) =>
        req.search.get("before") === older
          ? page("00000000-0000-4000-8000-0000000000c2", "Made Tom Okafor Viewer", null)
          : page(older, "Made Tom Okafor Editor", older),
    });
    renderInWorkspace(<ActivityPage workspaceId={W} />);
    expect(await screen.findByText("Made Tom Okafor Editor")).toBeTruthy();
    expect(screen.getByText("Deleted user")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(await screen.findByText("Made Tom Okafor Viewer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
  });
});

describe("Settings › Data (F7.1, F7.2)", () => {
  it("downloads the ZIP, and deletes the workspace once its name is typed", async () => {
    const seen = fakeApi({ "DELETE /api/workspaces/:id": undefined });
    renderInWorkspace(
      <Routes>
        <Route path="/data" element={<DataSettings workspaceId={W} />} />
        <Route path="/" element={<p>Home</p>} />
      </Routes>,
      { path: "/data" },
    );
    expect(screen.getByRole("link", { name: "Download ZIP" }).getAttribute("href")).toBe(
      `/api/workspaces/${W}/export`,
    );
    expect(screen.getByText(/Drafts and mail in your mailbox stay there/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Delete workspace" });
    expect(button).toHaveProperty("disabled", true);
    await userEvent.type(
      screen.getByLabelText("Type Maria's workspace to confirm"),
      "Maria's workspace",
    );
    await userEvent.click(button);
    expect(await screen.findByText("Home")).toBeTruthy();
    expect(seen.find((r) => r.method === "DELETE")?.body).toEqual({ name: "Maria's workspace" });
  });

  it("offers no export to a pipeline-only admin, and no deletion to a non-owner", () => {
    fakeApi({});
    renderInWorkspace(<DataSettings workspaceId={W} />, {
      workspace: { scope: "pipeline", isOwner: false },
    });
    expect(screen.queryByRole("link", { name: "Download ZIP" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete workspace" })).toBeNull();
  });
});

describe("Your account (F7.3)", () => {
  it("lists what goes, and deletes the account with the password", async () => {
    const seen = fakeApi({
      "GET /api/auth/session": session,
      "GET /api/account/deletion": {
        owned: [
          {
            workspaceId: W,
            name: "Maria's workspace",
            members: [{ userId: TOM, name: "Tom Okafor" }],
          },
        ],
        memberOf: [{ workspaceId: "00000000-0000-4000-8000-0000000000bb", name: "Tom's search" }],
      },
      "DELETE /api/account": undefined,
    });
    renderInWorkspace(
      <Routes>
        <Route path="/account" element={<AccountPage />} />
        <Route path="/sign-in" element={<p>Sign in</p>} />
      </Routes>,
      { path: "/account" },
    );
    const owned = await screen.findByRole("list", { name: "Workspaces deleted with your account" });
    expect(owned.textContent).toContain("shared with Tom Okafor");
    expect(screen.getByRole("button", { name: "Leave Tom's search" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Your password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(await screen.findByText("Sign in")).toBeTruthy();
    expect(seen.find((r) => r.method === "DELETE")).toMatchObject({
      path: "/api/account",
      body: { password: "correct horse" },
    });
  });
});
