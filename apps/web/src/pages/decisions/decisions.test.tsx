import type { Decision } from "@jobfilly/schema";
import { act, cleanup, configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { useLiveInvalidation } from "../../hooks";
import { DecisionCount, DecisionsPage } from "./index";

// The decision inbox (F7.2, F7.5, F7.7) and the count in the navigation, against a fake API.

// Each step waits for a refetch through the fake API, which under heavy CPU load can take longer
// than Testing Library's 1-second default; a wait that would never succeed still fails, later.
const SLOW_MS = 10_000;
vi.setConfig({ testTimeout: 3 * SLOW_MS });
beforeAll(() => {
  configure({ asyncUtilTimeout: SLOW_MS });
});
afterAll(() => {
  configure({ asyncUtilTimeout: 1000 });
  vi.resetConfig();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const W = testWorkspace().id;
const BASE = `/api/workspaces/${W}/decisions`;
const CHF_120 = {
  amount: 120000,
  currency: "CHF",
  period: "year" as const,
  asWritten: "CHF 120,000",
};

const CHF: Decision = {
  id: "00000000-0000-4000-8000-0000000000c1",
  question: "Minimum pay in CHF per year?",
  profileKey: "min_pay",
  groupKey: "min_pay:CHF:year",
  choices: [{ label: "CHF 120,000", value: CHF_120 }],
  waiting: [
    { messageId: "<zurich@x.example>", position: 0, subject: "Backend in Zurich" },
    { messageId: "<basel@x.example>", position: 0, subject: "Backend in Basel" },
  ],
  status: "open",
  createdAt: "2026-10-15T12:00:00.000Z",
};
const RELOCATE: Decision = {
  ...CHF,
  id: "00000000-0000-4000-8000-0000000000c2",
  question: "Would you relocate to Ireland?",
  profileKey: "extra.relocate",
  groupKey: "extra.relocate",
  choices: [
    { label: "Yes", value: "Yes" },
    { label: "No", value: "No" },
  ],
  waiting: [{ messageId: "<dublin@x.example>", position: 0, subject: "Remote-first, Dublin" }],
};

const card = (question: string) => screen.getByRole("article", { name: question }) as HTMLElement;

describe("the Decisions page (F7.2)", () => {
  it("shows the question, the waiting messages, the choices plus free text, and Use for similar mail", async () => {
    fakeApi({ [`GET ${BASE}`]: { items: [CHF, RELOCATE] } });
    renderInWorkspace(<DecisionsPage workspaceId={W} />);
    await screen.findByRole("heading", { name: "Minimum pay in CHF per year?" });
    const chf = within(card("Minimum pay in CHF per year?"));
    expect(chf.getByText("2 messages are waiting on this:")).toBeTruthy();
    expect(chf.getByRole("link", { name: "Backend in Zurich" }).getAttribute("href")).toBe(
      `/w/${W}/inbox/${encodeURIComponent("<zurich@x.example>")}`,
    );
    expect(chf.getByRole("link", { name: "Backend in Basel" })).toBeTruthy();
    expect(chf.getByRole("radio", { name: "CHF 120,000" })).toBeTruthy();
    expect(chf.getByRole("radio", { name: "Something else" })).toBeTruthy();
    const similar = chf.getByRole("checkbox", { name: "Use this answer for similar mail" });
    expect((similar as HTMLInputElement).checked).toBe(true);
    expect(
      within(card("Would you relocate to Ireland?")).getByRole("radio", { name: "No" }),
    ).toBeTruthy();
  });

  it("answers with a choice, or with free text", async () => {
    let items = [CHF, RELOCATE];
    const seen = fakeApi({
      [`GET ${BASE}`]: () => ({ items }),
      [`POST ${BASE}/:id/answer`]: (_req: FakeRequest, params: Record<string, string>) => {
        const answered = items.find((d) => d.id === params.id);
        items = items.filter((d) => d.id !== params.id);
        return { ...answered, status: "answered", waiting: [] };
      },
    });
    renderInWorkspace(<DecisionsPage workspaceId={W} />);
    await screen.findByRole("heading", { name: "Minimum pay in CHF per year?" });
    const chf = within(card("Minimum pay in CHF per year?"));
    const answer = chf.getByRole("button", { name: "Answer" }) as HTMLButtonElement;
    expect(answer.disabled).toBe(true);
    await userEvent.click(chf.getByRole("radio", { name: "CHF 120,000" }));
    await userEvent.click(answer);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Minimum pay in CHF per year?" })).toBeNull(),
    );
    const relocate = within(card("Would you relocate to Ireland?"));
    await userEvent.click(relocate.getByRole("radio", { name: "Something else" }));
    await userEvent.type(relocate.getByLabelText("Your answer in your own words"), "Maybe in 2027");
    await userEvent.click(
      relocate.getByRole("checkbox", { name: "Use this answer for similar mail" }),
    );
    await userEvent.click(relocate.getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(screen.getByText(/Nothing to decide/)).toBeTruthy());
    expect(seen.filter((r) => r.method === "POST").map((r) => [r.path, r.body])).toEqual([
      [`${BASE}/${CHF.id}/answer`, { value: CHF_120, useForSimilar: true }],
      [`${BASE}/${RELOCATE.id}/answer`, { value: "Maybe in 2027", useForSimilar: false }],
    ]);
  });

  it("says why a rule's question is answered for its messages only", async () => {
    const rule: Decision = {
      ...RELOCATE,
      id: "00000000-0000-4000-8000-0000000000c3",
      question: "Reply to this agency role?",
      profileKey: null,
      groupKey: "rule:00000000-0000-4000-8000-0000000000e1",
    };
    const seen = fakeApi({
      [`GET ${BASE}`]: { items: [rule] },
      [`POST ${BASE}/:id/answer`]: { ...rule, status: "answered", waiting: [] },
    });
    renderInWorkspace(<DecisionsPage workspaceId={W} />);
    await screen.findByRole("heading", { name: "Reply to this agency role?" });
    const similar = screen.getByRole("checkbox", {
      name: "Use this answer for similar mail",
    }) as HTMLInputElement;
    expect(similar.checked).toBe(false);
    expect(similar.disabled).toBe(true);
    expect(screen.getByText(/One of your rules asks this for each message/)).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(seen.some((r) => r.method === "POST")).toBe(true));
    expect(seen.find((r) => r.method === "POST")?.body).toEqual({
      value: "Yes",
      useForSimilar: false,
    });
  });

  it("answers a no for the waiting messages only, as it writes nothing to the profile", async () => {
    const dublin: Decision = {
      ...RELOCATE,
      id: "00000000-0000-4000-8000-0000000000c4",
      question: "Hybrid in Dublin?",
      profileKey: "places",
      groupKey: "places:IE:Dublin:hybrid",
      choices: [
        { label: "Yes", value: { country: "IE", city: "Dublin", mode: "hybrid" } },
        { label: "No", value: "No" },
      ],
    };
    const seen = fakeApi({
      [`GET ${BASE}`]: { items: [dublin] },
      [`POST ${BASE}/:id/answer`]: { ...dublin, status: "answered", waiting: [] },
    });
    renderInWorkspace(<DecisionsPage workspaceId={W} />);
    await screen.findByRole("heading", { name: "Hybrid in Dublin?" });
    const similar = screen.getByRole("checkbox", {
      name: "Use this answer for similar mail",
    }) as HTMLInputElement;
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    expect(similar.checked).toBe(true);
    expect(similar.disabled).toBe(false);
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(similar.checked).toBe(false);
    expect(similar.disabled).toBe(true);
    expect(screen.getByText(/nothing is added to your profile/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    await waitFor(() => expect(seen.some((r) => r.method === "POST")).toBe(true));
    expect(seen.find((r) => r.method === "POST")?.body).toEqual({
      value: "No",
      useForSimilar: false,
    });
  });

  it("keeps a decision with Not now, and closes it for one message with Don't ask", async () => {
    let items = [CHF];
    const seen = fakeApi({
      [`GET ${BASE}`]: () => ({ items }),
      [`POST ${BASE}/:id/not-now`]: () => CHF,
      [`POST ${BASE}/:id/dismiss`]: (req: FakeRequest) => {
        const role = req.body as { messageId: string };
        items = [{ ...CHF, waiting: CHF.waiting.filter((w) => w.messageId !== role.messageId) }];
        return items[0];
      },
    });
    renderInWorkspace(<DecisionsPage workspaceId={W} />);
    await screen.findByRole("heading", { name: "Minimum pay in CHF per year?" });
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(await screen.findByText(/Kept for later/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Minimum pay in CHF per year?" })).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Don't ask for this message: Backend in Basel" }),
    );
    await waitFor(() => expect(screen.getByText("1 message is waiting on this:")).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Backend in Basel" })).toBeNull();
    expect(seen.filter((r) => r.method === "POST").map((r) => [r.path, r.body])).toEqual([
      [`${BASE}/${CHF.id}/not-now`, undefined],
      [`${BASE}/${CHF.id}/dismiss`, { messageId: "<basel@x.example>", position: 0 }],
    ]);
  });

  it("lets viewers see decisions but not answer them (F7.7)", async () => {
    fakeApi({ [`GET ${BASE}`]: { items: [CHF] } });
    renderInWorkspace(<DecisionsPage workspaceId={W} />, { role: "viewer" });
    await screen.findByRole("heading", { name: "Minimum pay in CHF per year?" });
    expect((screen.getByRole("radio", { name: "CHF 120,000" }) as HTMLInputElement).disabled).toBe(
      true,
    );
    for (const name of ["Answer", "Not now", "Don't ask for this message: Backend in Zurich"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText("Viewers can see decisions but can't answer them.")).toBeTruthy();
  });
});

/** A stand-in for the browser's EventSource. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = FakeEventSource.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, cb: (e: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
  }
  close() {}
  emit(type: string, data: string) {
    for (const cb of this.listeners.get(type) ?? []) cb({ data });
  }
}

function Live({ workspaceId }: { workspaceId: string }) {
  useLiveInvalidation(workspaceId);
  return <DecisionCount workspaceId={workspaceId} />;
}

describe("the open count in the navigation", () => {
  it("shows the open count and updates live on decisions.updated", async () => {
    FakeEventSource.all = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    let open = 2;
    fakeApi({ [`GET ${BASE}/count`]: () => ({ open }) });
    renderInWorkspace(<Live workspaceId={W} />);
    expect(await screen.findByRole("img", { name: "2 open decisions" })).toBeTruthy();
    open = 1;
    act(() => FakeEventSource.all[0]?.emit("decisions.updated", "{}"));
    expect(await screen.findByRole("img", { name: "1 open decision" })).toBeTruthy();
    open = 0;
    act(() => FakeEventSource.all[0]?.emit("decisions.updated", "{}"));
    await waitFor(() => expect(screen.queryByRole("img", { name: /open decision/ })).toBeNull());
  });
});
