import type { SenderCheck } from "@jobfilly/schema";
import { cleanup, configure, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { SenderBadge, SenderPanel } from "./index";

// The sender badge on inbox rows and the sender panel in the message detail (F5.1–F5.4).
// A mark is a round trip to the fake API; waits get more than the default on a busy machine.
configure({ asyncUtilTimeout: 4000 });

const ws = testWorkspace();
const marksUrl = `/api/workspaces/${ws.id}/senders/marks`;
const from = { address: "hr.department@globalcareers-mail.example", name: "Global Careers HR" };

const scam: SenderCheck = {
  verdict: "high_risk",
  complete: true,
  reasons: [
    {
      signal: "asks_for_fee",
      reason:
        'Probably a scam sign: asks for a fee ("processing fee"); real employers rarely charge candidates',
    },
    {
      signal: "asks_for_id",
      reason:
        'Probably a scam sign: asks for a passport scan or ID documents before an offer ("scan of your passport")',
    },
  ],
  mark: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SenderBadge", () => {
  it("shows each verdict, and says when a check is incomplete", () => {
    renderInWorkspace(
      <>
        <SenderBadge sender={{ verdict: "looks_fine", complete: true }} />
        <SenderBadge sender={{ verdict: "caution", complete: false }} />
        <SenderBadge sender={{ verdict: "high_risk", complete: true }} />
        <SenderBadge sender={null} />
      </>,
    );
    expect(screen.getByRole("img", { name: "Sender check: Looks fine" }).textContent).toBe(
      "Looks fine",
    );
    expect(screen.getByRole("img", { name: "Sender check: Caution, incomplete" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Sender check: High risk" }).textContent).toBe(
      "High risk",
    );
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });
});

describe("SenderPanel", () => {
  it("shows the reasons and the high-risk warning, with Trusted and Blocked for editors", async () => {
    const seen = fakeApi({ [`PUT ${marksUrl}`]: (req: FakeRequest) => req.body });
    renderInWorkspace(
      <SenderPanel workspaceId={ws.id} messageId="<m@x>" from={from} check={scam} />,
      {
        role: "editor",
      },
    );
    expect(screen.getByRole("img", { name: "Sender check: High risk" })).toBeTruthy();
    const panel = screen.getByRole("region", { name: "Sender check" });
    expect(panel.textContent).toContain("asks for a fee");
    expect(panel.textContent).toContain("asks for a passport scan");
    expect(panel.textContent).toContain("These are estimates");
    expect(screen.getByText("This sender looks high risk")).toBeTruthy();
    expect(panel.textContent).toContain("No reply is drafted for it automatically.");

    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Blocked" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(seen.find((r) => r.method === "PUT")).toMatchObject({
      path: marksUrl,
      body: { scope: "address", value: from.address, mark: "blocked" },
    });
  });

  it("clears a mark when its button is pressed again", async () => {
    const seen = fakeApi({ [`PUT ${marksUrl}`]: (req: FakeRequest) => req.body });
    const trusted: SenderCheck = {
      verdict: "looks_fine",
      complete: true,
      reasons: [
        {
          signal: "marked_trusted",
          reason: `Trusted: the address ${from.address} is marked trusted in this workspace`,
        },
      ],
      mark: "trusted",
    };
    renderInWorkspace(
      <SenderPanel workspaceId={ws.id} messageId="<m@x>" from={from} check={trusted} />,
      { role: "editor" },
    );
    expect(screen.getByText(/is marked trusted in this workspace/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Trusted" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(button);
    await waitFor(() => expect(seen.some((r) => r.method === "PUT")).toBe(true));
    expect(seen.find((r) => r.method === "PUT")?.body).toEqual({
      scope: "address",
      value: from.address,
      mark: null,
    });
  });

  it("shows viewers the reasons and the warning, but no Trusted or Blocked", () => {
    renderInWorkspace(
      <SenderPanel workspaceId={ws.id} messageId="<m@x>" from={from} check={scam} />,
      {
        role: "viewer",
      },
    );
    expect(screen.getByText("This sender looks high risk")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Sender check" }).textContent).toContain(
      "asks for a fee",
    );
    expect(screen.queryByRole("button", { name: "Trusted" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Blocked" })).toBeNull();
  });

  it("says when a check is incomplete, and when there is none yet", () => {
    const incomplete: SenderCheck = {
      verdict: "caution",
      complete: false,
      reasons: [
        {
          signal: "lookup_failed",
          reason:
            "Couldn't look up when tidewater.example was registered, so this check is incomplete",
        },
      ],
      mark: null,
    };
    const { unmount } = renderInWorkspace(
      <SenderPanel workspaceId={ws.id} messageId="<m@x>" from={from} check={incomplete} />,
    );
    expect(screen.getByRole("img", { name: "Sender check: Caution, incomplete" })).toBeTruthy();
    expect(screen.getByText(/some checks couldn't be done/)).toBeTruthy();
    expect(screen.queryByText("This sender looks high risk")).toBeNull();
    unmount();
    renderInWorkspace(
      <SenderPanel workspaceId={ws.id} messageId="<m@x>" from={from} check={null} />,
    );
    expect(screen.getByText("Not checked yet.")).toBeTruthy();
  });
});
