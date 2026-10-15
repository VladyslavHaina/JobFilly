import {
  CORE_PROFILE_KEYS,
  CORE_PROFILE_LABELS,
  type CurrentScan,
  type IntakeEdit,
  type IntakeForm,
  type IntakeProposalEntry,
  type MessageDetail,
  NOT_ENOUGH_EVIDENCE,
  type Profile,
  type Role,
} from "@jobfilly/schema";
import { cleanup, configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  json,
  renderApp,
  TEST_USER,
  testWorkspace,
} from "../../components/testing";
import { paths } from "../../paths";

// The intake form inside the app's own routes, against a fake API (F6.1-F6.4, F6.6, F6.7, S4).

/**
 * How long a wait may take. Waits here cross a route's first render, a navigation and fetches,
 * which under heavy CPU load take longer than Testing Library's 1-second default; a wait that
 * would never succeed still fails, only later.
 */
const SLOW_MS = 10_000;

// Before the tests are collected, so each gets room to wait SLOW_MS (Vitest's default is 5 s).
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

const replyId = (n: number) => `<maria-reply-${n}@inbox.example>`;
const jobId = (n: number) => `<job-${n}+x/y@agency.example>`;

const evidence = (ids: string[], reason: string) => ids.map((messageId) => ({ messageId, reason }));

function empty(key: (typeof CORE_PROFILE_KEYS)[number]): IntakeProposalEntry {
  return {
    key,
    label: CORE_PROFILE_LABELS[key],
    value: [],
    confidence: null,
    evidence: [],
    emptyReason: NOT_ENOUGH_EVIDENCE,
  };
}

const answered = (
  key: (typeof CORE_PROFILE_KEYS)[number],
  value: IntakeProposalEntry["value"],
  confidence: "high" | "medium" | "low",
  ev: { messageId: string; reason: string }[],
): IntakeProposalEntry => ({
  key,
  label: CORE_PROFILE_LABELS[key],
  value,
  confidence,
  evidence: ev,
  emptyReason: null,
});

const MARIA_ENTRIES: IntakeProposalEntry[] = CORE_PROFILE_KEYS.map((key) => {
  const replies3 = evidence([1, 2, 3].map(replyId), "from 3 of your replies");
  switch (key) {
    case "target_roles":
      return answered(key, ["Backend Engineer", "Backend Developer"], "high", replies3);
    case "seniority":
      return answered(
        key,
        ["Senior"],
        "low",
        evidence([1, 2, 3, 4, 5].map(jobId), "in 5 job emails"),
      );
    case "places":
      return answered(
        key,
        [
          { country: "DE", city: "Berlin", mode: "hybrid" },
          { country: "NL", city: "Amsterdam", mode: "hybrid" },
        ],
        "medium",
        evidence([1, 2].map(replyId), "from 2 of your replies"),
      );
    case "contracts":
      return answered(key, ["permanent", "B2B"], "high", replies3);
    case "min_pay":
      return answered(
        key,
        [
          { amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" },
          { amount: 450, currency: "EUR", period: "day", asWritten: "€450 a day" },
        ],
        "high",
        replies3,
      );
    default:
      return empty(key);
  }
});

const QUESTION = {
  slug: "relocation",
  label: "Would you relocate within the EU for the right role?",
  options: ["Yes", "No"],
  evidence: [replyId(2)],
};

const DETAILS: Record<string, MessageDetail> = Object.fromEntries(
  [
    ...[1, 2, 3].map((n) => ({
      id: replyId(n),
      from: { address: TEST_USER.email, name: TEST_USER.name },
      subject: `Re: Backend role ${n}`,
      date: `2026-09-2${n}T10:00:00.000Z`,
      category: null,
      categorySource: null,
      analysisStatus: "done" as const,
      fit: null,
      sender: null,
      hidden: null,
      draft: null,
      roles: [],
      ownReply: true,
      senderCheck: null,
    })),
    ...[1, 2, 3, 4, 5].map((n) => ({
      id: jobId(n),
      from: { address: "recruiter@agency.example", name: "Recruiter" },
      subject: `Senior role ${n}`,
      date: `2026-09-1${n}T10:00:00.000Z`,
      category: "recruiter_outreach" as const,
      categorySource: "scan" as const,
      analysisStatus: "done" as const,
      fit: null,
      sender: null,
      hidden: null,
      draft: null,
      roles: [],
      ownReply: false,
      senderCheck: null,
    })),
  ].map((d) => [d.id, d]),
);

const stopped: CurrentScan = {
  progress: {
    scanId: "00000000-0000-4000-8000-0000000000c1",
    kind: "first",
    status: "stopped",
    stopReason: "confident",
    handledWithoutAi: 300,
    likely: 260,
    analyzed: 40,
    jobFound: 35,
    answersFirm: 5,
    notAnalyzed: 220,
    calls: 40,
    tokens: 12000,
  },
  stopMessage: "Stopped: confident after 40 of 260 likely job emails",
  stoppedAt: "2026-10-01T10:30:00.000Z",
  totalTokens: 12000,
};

const NO_SCAN: CurrentScan = { progress: null, stopMessage: null, stoppedAt: null, totalTokens: 0 };

interface Options {
  role?: Role;
  entries?: IntakeProposalEntry[];
  extras?: IntakeForm["extras"];
  scan?: CurrentScan;
  profiles?: Profile[];
  /** Holds each PUT until it resolves, to click again while a write is on its way. */
  beforePut?: () => Promise<void>;
}

/** A fake API for the form: it keeps edits and makes the profile on Confirm, like the server. */
function intakeApi(options: Options = {}) {
  const ws = testWorkspace({ role: options.role ?? "admin" });
  const state = {
    form: {
      proposal: { entries: options.entries ?? MARIA_ENTRIES },
      edits: [] as IntakeEdit[],
      extras: options.extras ?? { status: "done", questions: [QUESTION] },
    } satisfies IntakeForm,
    profiles: options.profiles ?? ([] as Profile[]),
  };
  const requests = fakeApi({
    "GET /api/auth/session": { user: TEST_USER },
    "GET /api/workspaces": { items: [ws] },
    "GET /api/invites": { items: [] },
    "GET /api/workspaces/:id/scans/current": options.scan ?? stopped,
    "GET /api/workspaces/:id/intake": () => structuredClone(state.form),
    "PUT /api/workspaces/:id/intake/answers/:key": async (
      req: FakeRequest,
      p: Record<string, string>,
    ) => {
      await options.beforePut?.();
      const edit: IntakeEdit = {
        key: p.key as IntakeEdit["key"],
        value: (req.body as { value: IntakeEdit["value"] }).value,
        source: "you",
        updatedBy: TEST_USER.id,
        updatedAt: "2026-10-01T10:00:00.000Z",
      };
      state.form.edits = [...state.form.edits.filter((e) => e.key !== edit.key), edit];
      return edit;
    },
    "POST /api/workspaces/:id/intake/confirm": () => {
      const profile: Profile = {
        id: "00000000-0000-4000-8000-0000000000f1",
        workspaceId: ws.id,
        name: "My job search",
        confirmedAt: "2026-10-01T10:05:00.000Z",
        entries: state.form.proposal.entries.map((e) => {
          const edit = state.form.edits.find((x) => x.key === e.key);
          return {
            key: e.key,
            label: e.label,
            value: edit?.value ?? e.value,
            confidence: edit ? null : e.confidence,
            evidence: e.evidence,
            source: edit ? "you" : "scan",
            updatedAt: "2026-10-01T10:05:00.000Z",
            updatedBy: edit ? TEST_USER.id : null,
          };
        }),
      };
      state.profiles = [profile];
      return json(profile, 201);
    },
    "GET /api/workspaces/:id/profiles": () => ({ items: state.profiles }),
    "GET /api/workspaces/:id/messages": { items: [], nonJobCount: 0, page: 1, nextPage: null },
    "GET /api/workspaces/:id/messages/:messageId": (_req: FakeRequest, p: Record<string, string>) =>
      DETAILS[p.messageId ?? ""] ?? json({ error: "not_found" }, 404),
    "GET /api/workspaces/:id/messages/:messageId/body": { text: "Thanks, hybrid in Berlin works." },
  });
  return { ws, requests, state };
}

const card = (label: string) => screen.findByRole("region", { name: label });
/** The PUT requests sent so far. */
const puts = (requests: FakeRequest[]) => requests.filter((r) => r.method === "PUT");

describe("the intake form (F6.1, F6.2)", () => {
  it("is not asked for until the first scan has stopped", async () => {
    const running = structuredClone(stopped);
    if (running.progress) running.progress.status = "running";
    const { ws, requests } = intakeApi({ scan: running });
    renderApp(paths.intake(ws.id));
    expect(await screen.findByText("Not ready yet")).toBeTruthy();
    expect(
      screen.getByText("The first scan is still reading your mail.", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the scan" }).getAttribute("href")).toBe(
      paths.scan(ws.id),
    );
    expect(requests.some((r) => r.path.endsWith("/intake"))).toBe(false);
  });

  it("before any scan, sends an admin to start it", async () => {
    const { ws, requests } = intakeApi({ scan: NO_SCAN });
    renderApp(paths.intake(ws.id));
    expect(await screen.findByText("Not ready yet")).toBeTruthy();
    expect(
      screen.getByText("Start it once your mailbox and AI are set up.", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start the first scan" }).getAttribute("href")).toBe(
      paths.scan(ws.id),
    );
    expect(requests.some((r) => r.path.endsWith("/intake"))).toBe(false);
  });

  it("before any scan, tells an editor or viewer who starts it", async () => {
    for (const role of ["editor", "viewer"] as const) {
      const { ws } = intakeApi({ scan: NO_SCAN, role });
      renderApp(paths.intake(ws.id));
      expect(
        await screen.findByText("An admin of this workspace starts it.", { exact: false }),
      ).toBeTruthy();
      expect(screen.getByRole("link", { name: "See the scan" }).getAttribute("href")).toBe(
        paths.scan(ws.id),
      );
      expect(screen.queryByRole("link", { name: "Start the first scan" })).toBeNull();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("is pre-filled with every core question, how sure the app is and why", async () => {
    const { ws } = intakeApi();
    renderApp(paths.intake(ws.id));
    for (const key of CORE_PROFILE_KEYS) expect(await card(CORE_PROFILE_LABELS[key])).toBeTruthy();
    const pay = within(await card("Minimum pay"));
    expect(pay.getByText("High confidence")).toBeTruthy();
    expect(pay.getByText("from 3 of your replies")).toBeTruthy();
    expect(pay.getByText("€70,000 per year (“€70,000 a year”)")).toBeTruthy();
    expect(pay.getByText("€450 per day (“€450 a day”)")).toBeTruthy();
    const places = within(await card("Places you'd work onsite or hybrid"));
    expect(places.getByText("Medium confidence")).toBeTruthy();
    expect(places.getByText("from 2 of your replies")).toBeTruthy();
    expect(places.getByText("Berlin, Germany (hybrid)")).toBeTruthy();
    const seniority = within(await card("Seniority"));
    expect(seniority.getByText("Low confidence")).toBeTruthy();
    expect(seniority.getByText("in 5 job emails")).toBeTruthy();
    expect(within(await card("Deal-breakers")).getByText("Not enough evidence")).toBeTruthy();
  });

  it("links to every evidence message, the user's replies included, and opens them in the inbox", async () => {
    const { ws } = intakeApi();
    const { router } = renderApp(paths.intake(ws.id));
    const user = userEvent.setup();
    const pay = within(await card("Minimum pay"));
    await user.click(pay.getByRole("button", { name: "Show the 3 emails" }));
    const list = within(pay.getByRole("list", { name: "Evidence for Minimum pay" }));
    const links = list.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(
      [1, 2, 3].map((n) => paths.message(ws.id, replyId(n))),
    );
    expect(await list.findByText("Your reply: Re: Backend role 1")).toBeTruthy();

    const seniority = within(await card("Seniority"));
    await user.click(seniority.getByRole("button", { name: "Show the 5 emails" }));
    const jobLinks = within(seniority.getByRole("list", { name: "Evidence for Seniority" }));
    expect(jobLinks.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(
      [1, 2, 3, 4, 5].map((n) => paths.message(ws.id, jobId(n))),
    );

    await user.click(await list.findByRole("link", { name: "Your reply: Re: Backend role 1" }));
    expect(router.state.location.pathname).toBe(paths.message(ws.id, replyId(1)));
    expect(await screen.findByRole("heading", { name: "Re: Backend role 1" })).toBeTruthy();
    expect(screen.getByText("Your reply")).toBeTruthy();
  });

  it("makes low-confidence and empty answers stand out (F6.3)", async () => {
    const { ws } = intakeApi();
    renderApp(paths.intake(ws.id));
    const seniority = await card("Seniority");
    expect(seniority.dataset.attention).toBe("true");
    expect(within(seniority).getByText("Not sure about this one: please check it.")).toBeTruthy();
    const dealBreakers = await card("Deal-breakers");
    expect(dealBreakers.dataset.attention).toBe("true");
    expect(
      within(dealBreakers).getByText(
        "Nothing found in your mail. Add an answer if it matters to you.",
      ),
    ).toBeTruthy();
    expect((await card("Minimum pay")).dataset.attention).toBeUndefined();
    expect((await card("Places you'd work onsite or hybrid")).dataset.attention).toBeUndefined();
  });

  it("makes an unanswered extra question stand out until it is answered (F6.3)", async () => {
    const { ws } = intakeApi();
    renderApp(paths.intake(ws.id));
    const extra = await card(QUESTION.label);
    expect(extra.dataset.attention).toBe("true");
    expect(within(extra).getByText("Not answered yet")).toBeTruthy();
    expect(within(extra).getByText("raised in 1 email")).toBeTruthy();
    expect(
      within(extra).getByText(
        "Your mail raises this but doesn't answer it. Pick an answer if it matters to you.",
      ),
    ).toBeTruthy();
    await userEvent.setup().click(within(extra).getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(extra.dataset.attention).toBeUndefined());
    expect(within(extra).getByText("Set by you")).toBeTruthy();
    expect(within(extra).queryByText("Not answered yet")).toBeNull();
  });

  it("shows the extra questions once they are found", async () => {
    const { ws, state } = intakeApi({ extras: { status: "pending", questions: [] } });
    const { queryClient } = renderApp(paths.intake(ws.id));
    expect(await screen.findByText("Looking for more questions in your mail…")).toBeTruthy();
    expect(screen.queryByRole("region", { name: QUESTION.label })).toBeNull();
    // Confirming now would save the profile without them, so it waits.
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveProperty("disabled", true);
    expect(
      screen.getByText("You can confirm once the questions from your mail have shown up."),
    ).toBeTruthy();
    state.form.extras = { status: "done", questions: [QUESTION] };
    // What useLiveInvalidation does on intake.updated.
    await queryClient.invalidateQueries({ queryKey: ["w", ws.id, "intake"] });
    const extra = within(await card(QUESTION.label));
    expect(extra.getByRole("button", { name: "Yes", pressed: false })).toBeTruthy();
    expect(screen.queryByText("Looking for more questions in your mail…")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveProperty("disabled", false);
  });
});

describe("corrections (F6.4, S4)", () => {
  it("are clicks, and the form can be finished without typing", async () => {
    const { ws, requests } = intakeApi();
    renderApp(paths.intake(ws.id));
    const user = userEvent.setup({ delay: null });
    const keyboard = vi.spyOn(user, "keyboard");
    const type = vi.spyOn(user, "type");

    const places = within(await card("Places you'd work onsite or hybrid"));
    await user.click(
      places.getByRole("button", { name: "Remove Amsterdam, Netherlands (hybrid)" }),
    );
    await waitFor(() => expect(places.queryByText("Amsterdam, Netherlands (hybrid)")).toBeNull());
    expect(places.getByText("Set by you")).toBeTruthy();
    expect(puts(requests).at(-1)).toMatchObject({
      path: `/api/workspaces/${ws.id}/intake/answers/places`,
      body: { value: [{ country: "DE", city: "Berlin", mode: "hybrid" }] },
    });

    const replyTo = within(await card("Mail that should get a reply"));
    await user.click(replyTo.getByRole("button", { name: "Recruiter outreach", pressed: false }));
    expect(
      await replyTo.findByRole("button", { name: "Recruiter outreach", pressed: true }),
    ).toBeTruthy();
    expect(puts(requests).at(-1)?.body).toEqual({ value: ["recruiter_outreach"] });

    const extra = within(await card(QUESTION.label));
    await user.click(extra.getByRole("button", { name: "Yes", pressed: false }));
    expect(await extra.findByRole("button", { name: "Yes", pressed: true })).toBeTruthy();
    expect(puts(requests).at(-1)).toMatchObject({
      path: `/api/workspaces/${ws.id}/intake/answers/extra.relocation`,
      body: { value: ["Yes"] },
    });

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    // What Confirm leads to is the next test's; here it is enough that it was sent.
    await waitFor(
      () =>
        expect(requests.filter((r) => r.method === "POST").map((r) => r.path)).toEqual([
          `/api/workspaces/${ws.id}/intake/confirm`,
        ]),
      { timeout: SLOW_MS },
    );
    expect(keyboard).not.toHaveBeenCalled();
    expect(type).not.toHaveBeenCalled();
  });

  it("are confirmed with one click that opens the saved profile", async () => {
    const { ws, requests } = intakeApi({ extras: { status: "done", questions: [] } });
    const { router } = renderApp(paths.intake(ws.id));
    const user = userEvent.setup({ delay: null });
    await card("Places you'd work onsite or hybrid");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    // Navigating and loading the profile take longer under load; wait for each explicitly.
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.profile(ws.id)), {
      timeout: SLOW_MS,
    });
    expect(
      await screen.findByRole("heading", { name: "My job search" }, { timeout: SLOW_MS }),
    ).toBeTruthy();
    expect(requests.filter((r) => r.method === "POST").map((r) => r.path)).toEqual([
      `/api/workspaces/${ws.id}/intake/confirm`,
    ]);
  });

  it("keep every quick click: each builds on the one before, and they are saved in order", async () => {
    const held: (() => void)[] = [];
    const { ws, requests, state } = intakeApi({
      beforePut: () => new Promise<void>((resolve) => held.push(resolve)),
    });
    renderApp(paths.intake(ws.id));
    const user = userEvent.setup();
    const release = async (n: number) => {
      await waitFor(() => expect(held).toHaveLength(n));
      held[n - 1]?.();
    };

    const places = within(await card("Places you'd work onsite or hybrid"));
    await user.click(
      places.getByRole("button", { name: "Remove Amsterdam, Netherlands (hybrid)" }),
    );
    // Before the first PUT has answered.
    await user.click(places.getByRole("button", { name: "Remove Berlin, Germany (hybrid)" }));
    expect(places.queryByText("Amsterdam, Netherlands (hybrid)")).toBeNull();
    expect(places.queryByText("Berlin, Germany (hybrid)")).toBeNull();
    const replyTo = within(await card("Mail that should get a reply"));
    await user.click(replyTo.getByRole("button", { name: "Recruiter outreach" }));
    await user.click(replyTo.getByRole("button", { name: "Interview" }));
    // One write at a time: the next starts once the one before has answered.
    await waitFor(() => expect(puts(requests)).toHaveLength(1));
    for (let n = 1; n <= 4; n++) await release(n);

    await waitFor(() => expect(puts(requests)).toHaveLength(4));
    expect(puts(requests).map((r) => r.body)).toEqual([
      { value: [{ country: "DE", city: "Berlin", mode: "hybrid" }] },
      { value: [] },
      { value: ["recruiter_outreach"] },
      { value: ["recruiter_outreach", "interview"] },
    ]);
    await waitFor(() =>
      expect(state.form.edits.map((e) => [e.key, e.value])).toEqual([
        ["places", []],
        ["reply_to", ["recruiter_outreach", "interview"]],
      ]),
    );
    expect(places.queryByText("Amsterdam, Netherlands (hybrid)")).toBeNull();
    expect(places.queryByText("Berlin, Germany (hybrid)")).toBeNull();
    expect(replyTo.getByRole("button", { name: "Recruiter outreach", pressed: true })).toBeTruthy();
    expect(replyTo.getByRole("button", { name: "Interview", pressed: true })).toBeTruthy();
  });

  it("choose no pay period or work mode for the user", async () => {
    const { ws, requests } = intakeApi({
      entries: CORE_PROFILE_KEYS.map(empty),
      extras: { status: "done", questions: [] },
    });
    renderApp(paths.intake(ws.id));
    const user = userEvent.setup();

    const pay = within(await card("Minimum pay"));
    expect(pay.getByLabelText("Period")).toHaveProperty("value", "");
    await user.type(pay.getByLabelText("Amount"), "450");
    await user.type(pay.getByLabelText("Currency code"), "EUR");
    await user.click(pay.getByRole("button", { name: "Add" }));
    expect(await pay.findByText("Choose a period")).toBeTruthy();

    const places = within(await card("Places you'd work onsite or hybrid"));
    expect(places.getByLabelText("Work mode")).toHaveProperty("value", "");
    await user.type(places.getByLabelText("Country code"), "NL");
    await user.click(places.getByRole("button", { name: "Add" }));
    expect(await places.findByText("Choose onsite or hybrid")).toBeTruthy();
    expect(puts(requests)).toEqual([]);

    await user.selectOptions(pay.getByLabelText("Period"), "day");
    await user.click(pay.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(puts(requests).at(-1)?.body).toEqual({
        value: [{ amount: 450, currency: "EUR", period: "day", asWritten: "450 EUR per day" }],
      }),
    );
    expect(pay.queryByText("Choose a period")).toBeNull();
    expect(pay.getByLabelText("Period")).toHaveProperty("value", "");
  });

  it("let Tom type into his empty answers (F6.6)", async () => {
    const { ws, requests } = intakeApi({
      entries: CORE_PROFILE_KEYS.map(empty),
      extras: { status: "done", questions: [] },
    });
    renderApp(paths.intake(ws.id));
    for (const key of CORE_PROFILE_KEYS) {
      const section = within(await card(CORE_PROFILE_LABELS[key]));
      expect(section.getByText("Not enough evidence"), key).toBeTruthy();
    }
    const user = userEvent.setup();
    const roles = within(await card("Roles you're looking for"));
    await user.type(roles.getByLabelText("Add to roles you're looking for"), "Staff Nurse");
    await user.click(roles.getByRole("button", { name: "Add" }));
    expect(await roles.findByText("Staff Nurse")).toBeTruthy();
    expect(puts(requests).at(-1)?.body).toEqual({ value: ["Staff Nurse"] });

    const pay = within(await card("Minimum pay"));
    await user.type(pay.getByLabelText("Amount"), "30");
    await user.type(pay.getByLabelText("Currency code"), "gbp");
    await user.selectOptions(pay.getByLabelText("Period"), "hour");
    await user.click(pay.getByRole("button", { name: "Add" }));
    expect(puts(requests).at(-1)).toMatchObject({
      path: `/api/workspaces/${ws.id}/intake/answers/min_pay`,
      body: {
        value: [{ amount: 30, currency: "GBP", period: "hour", asWritten: "30 GBP per hour" }],
      },
    });
    expect(await pay.findByText("£30 per hour (“30 GBP per hour”)")).toBeTruthy();

    const places = within(await card("Places you'd work onsite or hybrid"));
    await user.type(places.getByLabelText("City"), "Manchester");
    await user.type(places.getByLabelText("Country code"), "G");
    await user.click(places.getByRole("button", { name: "Add" }));
    expect(await places.findByText("Use the two-letter country code, like DE or GB")).toBeTruthy();
    expect(puts(requests).map((r) => r.path)).not.toContain(
      `/api/workspaces/${ws.id}/intake/answers/places`,
    );
  });

  it("ask to retype an amount the UI can't read for certain, and never save a guess", async () => {
    const { ws, requests } = intakeApi({
      entries: CORE_PROFILE_KEYS.map(empty),
      extras: { status: "done", questions: [] },
    });
    renderApp(paths.intake(ws.id));
    const user = userEvent.setup();
    const pay = within(await card("Minimum pay"));
    await user.type(pay.getByLabelText("Currency code"), "EUR");
    await user.selectOptions(pay.getByLabelText("Period"), "year");
    // In the UI's English, "70.000" would be seventy with three decimals; it may mean 70,000.
    await user.type(pay.getByLabelText("Amount"), "70.000");
    await user.click(pay.getByRole("button", { name: "Add" }));
    expect(await pay.findByText("Retype the amount, written like 1,234.50")).toBeTruthy();
    expect(puts(requests)).toEqual([]);

    await user.clear(pay.getByLabelText("Amount"));
    await user.type(pay.getByLabelText("Amount"), "70,000");
    await user.click(pay.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(puts(requests).at(-1)?.body).toEqual({
        value: [
          { amount: 70000, currency: "EUR", period: "year", asWritten: "70,000 EUR per year" },
        ],
      }),
    );
  });
});

describe("for viewers (F6.7)", () => {
  it("is all there and all disabled", async () => {
    const { ws, requests } = intakeApi({ role: "viewer" });
    renderApp(paths.intake(ws.id));
    expect(
      await screen.findByText("You can see the answers; only editors and admins can change them."),
    ).toBeTruthy();
    const places = within(await card("Places you'd work onsite or hybrid"));
    const remove = places.getByRole("button", { name: "Remove Amsterdam, Netherlands (hybrid)" });
    expect(remove).toHaveProperty("disabled", true);
    for (const label of [...CORE_PROFILE_KEYS.map((k) => CORE_PROFILE_LABELS[k]), QUESTION.label]) {
      const section = within(await card(label));
      for (const button of section.getAllByRole("button")) {
        if (/^(Show|Hide) the/.test(button.textContent ?? "")) continue;
        expect(button, `${label}: ${button.textContent}`).toHaveProperty("disabled", true);
      }
      for (const field of section.queryAllByRole("textbox")) {
        expect(field, label).toHaveProperty("disabled", true);
      }
    }
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveProperty("disabled", true);
    const user = userEvent.setup();
    await user.click(remove);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
    // Evidence is for everyone.
    await user.click(
      within(await card("Minimum pay")).getByRole("button", { name: "Show the 3 emails" }),
    );
    expect(screen.getByRole("list", { name: "Evidence for Minimum pay" })).toBeTruthy();
  });
});

describe("once confirmed", () => {
  it("says so, links to the profile, and changes nothing more", async () => {
    const profile: Profile = {
      id: "00000000-0000-4000-8000-0000000000f1",
      workspaceId: testWorkspace().id,
      name: "Remote EU",
      confirmedAt: "2026-10-01T10:05:00.000Z",
      entries: [],
    };
    const { ws } = intakeApi({ profiles: [profile] });
    renderApp(paths.intake(ws.id));
    expect(await screen.findByText("Saved as “Remote EU”.", { exact: false })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open your profile" }).getAttribute("href")).toBe(
      paths.profile(ws.id),
    );
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    const places = within(await card("Places you'd work onsite or hybrid"));
    expect(places.getByRole("button", { name: "Remove Berlin, Germany (hybrid)" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
