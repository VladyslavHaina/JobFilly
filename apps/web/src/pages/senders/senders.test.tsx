import type { AppliedSenderMark, SenderCheck, SenderMarkInput } from "@jobfilly/schema";
import { cleanup, configure, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  json,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { SenderBadge, SenderPanel } from "./index";

// The sender badge on inbox rows and the sender panel in the message detail (F5.1–F5.4).
// A mark is a round trip to the fake API; waits get more than the default on a busy machine.
configure({ asyncUtilTimeout: 4000 });

const ws = testWorkspace();
const marksUrl = `/api/workspaces/${ws.id}/senders/marks`;
// The mark is asked by the message (encoded as one path segment), never by the address.
const markOfMessageUrl = `/api/workspaces/${ws.id}/senders/messages/%3Cm%40x%3E/mark`;
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

type Applied = AppliedSenderMark["applied"];

/**
 * The marks API over one stored mark: GET answers it, PUT sets it or clears it, and a clear of
 * any other mark is a 404, as the server answers it. `keep` makes PUT answer 200 and change
 * nothing, to prove the buttons show what the server reads back.
 */
function markServer(initial: Applied, options: { keep?: boolean } = {}) {
  let applied = initial;
  return fakeApi({
    [`GET ${markOfMessageUrl}`]: () => ({ applied }),
    [`PUT ${marksUrl}`]: (req: FakeRequest) => {
      const input = req.body as SenderMarkInput;
      if (options.keep) return input;
      if (input.mark === null) {
        if (applied?.scope !== input.scope || applied.value !== input.value) {
          return json({ error: "not_found", message: "There is no such mark to clear" }, 404);
        }
        applied = null;
      } else {
        applied = { scope: input.scope, value: input.value, mark: input.mark };
      }
      return input;
    },
  });
}

const pressed = (name: "Trusted" | "Blocked") =>
  screen.getByRole("button", { name }).getAttribute("aria-pressed");
const enabled = (name: "Trusted" | "Blocked") =>
  !(screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

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
    const seen = markServer(null);
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

    await waitFor(() => expect(enabled("Blocked")).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));
    await waitFor(() => expect(pressed("Blocked")).toBe("true"));
    expect(seen.find((r) => r.method === "PUT")).toMatchObject({
      path: marksUrl,
      body: { scope: "address", value: from.address, mark: "blocked" },
    });
    // The mark is read by the message: no request line carries the sender's address, as proxies
    // and ingresses log request lines.
    const gets = seen.filter((r) => r.method === "GET");
    expect(gets.map((r) => r.path)).toContain(markOfMessageUrl);
    for (const r of seen) {
      expect(`${r.path}?${r.search}`).not.toMatch(/hr\.department|globalcareers/);
    }
  });

  it("clears a mark when its button is pressed again", async () => {
    const seen = markServer({ scope: "address", value: from.address, mark: "trusted" });
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
    await waitFor(() => expect(pressed("Trusted")).toBe("true"));
    await userEvent.click(screen.getByRole("button", { name: "Trusted" }));
    await waitFor(() => expect(pressed("Trusted")).toBe("false"));
    expect(seen.find((r) => r.method === "PUT")?.body).toEqual({
      scope: "address",
      value: from.address,
      mark: null,
    });
    expect(screen.queryByText(/no such mark|didn.t work|Couldn.t read/)).toBeNull();
  });

  it("clears a domain's mark for the whole domain, and says it is the domain's", async () => {
    const domain = "globalcareers-mail.example";
    const seen = markServer({ scope: "domain", value: domain, mark: "blocked" });
    const blocked: SenderCheck = {
      verdict: "high_risk",
      complete: true,
      reasons: [
        {
          signal: "marked_blocked",
          reason: `Blocked: the domain ${domain} is marked blocked in this workspace`,
        },
      ],
      mark: "blocked",
    };
    renderInWorkspace(
      <SenderPanel workspaceId={ws.id} messageId="<m@x>" from={from} check={blocked} />,
      { role: "editor" },
    );
    await waitFor(() => expect(pressed("Blocked")).toBe("true"));
    expect(
      screen.getByText(/for every email from the domain globalcareers-mail\.example/),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));
    await waitFor(() => expect(pressed("Blocked")).toBe("false"));
    expect(seen.find((r) => r.method === "PUT")?.body).toEqual({
      scope: "domain",
      value: domain,
      mark: null,
    });
    expect(
      screen.getByText(`Mark ${from.address} trusted or blocked for all its email.`),
    ).toBeTruthy();
    expect(screen.queryByText(/no such mark|didn.t work|Couldn.t read/)).toBeNull();
  });

  it("shows the mark the server reads back after a change, not the one asked for", async () => {
    markServer(
      { scope: "domain", value: "globalcareers-mail.example", mark: "blocked" },
      { keep: true },
    );
    renderInWorkspace(
      <SenderPanel workspaceId={ws.id} messageId="<m@x>" from={from} check={scam} />,
      { role: "editor" },
    );
    await waitFor(() => expect(pressed("Blocked")).toBe("true"));
    await userEvent.click(screen.getByRole("button", { name: "Blocked" }));
    await waitFor(() => expect(enabled("Blocked")).toBe(true));
    expect(pressed("Blocked")).toBe("true");
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
