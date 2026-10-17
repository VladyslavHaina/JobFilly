import type { Pipeline, PipelineItem } from "@jobfilly/schema";
import { cleanup, configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { PipelinePage } from "./index";

// The pipeline page (F5.1–F5.3) against a fake API: roles grouped by stage, how long each has
// been there and the next step, the no-reply flag, the same role from two agencies once with both
// senders, and a stage set by hand (editors only).

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
const BASE = `/api/workspaces/${W}/pipeline`;
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const OFFER: PipelineItem = {
  role: { messageId: "<conf@globex>", position: 0 },
  roles: [{ messageId: "<conf@globex>", position: 0 }],
  title: "Platform Engineer",
  company: "Globex",
  senders: [{ address: "hr@globex.example", name: "Globex HR" }],
  stage: "offer",
  stageSource: "derived",
  since: daysAgo(3),
  nextStep: "Decide on the offer",
  noReply: false,
};
const SILENT: PipelineItem = {
  ...OFFER,
  role: { messageId: "<umbrella@hr>", position: 0 },
  roles: [{ messageId: "<umbrella@hr>", position: 0 }],
  title: "SRE",
  company: "Umbrella",
  senders: [{ address: "hr@umbrella.example", name: null }],
  stage: "replied",
  since: daysAgo(25),
  nextStep: "Follow up: no answer for 25 days",
  noReply: true,
};
const TWO_AGENCIES: PipelineItem = {
  ...OFFER,
  role: { messageId: "<hays@agency>", position: 0 },
  roles: [
    { messageId: "<hays@agency>", position: 0 },
    { messageId: "<randstad@agency>", position: 0 },
  ],
  title: "Backend Engineer",
  company: "Hooli",
  senders: [
    { address: "anna@hays.example", name: "Anna" },
    { address: "ben@randstad.example", name: null },
  ],
  stage: "new",
  since: daysAgo(0),
  nextStep: "Decide whether to reply",
};

function pipeline(items: PipelineItem[]): Pipeline {
  const stages = [
    "new",
    "replied",
    "applied",
    "interview",
    "assessment",
    "offer",
    "rejected",
    "closed",
  ] as const;
  return {
    stages: stages.map((stage) => ({ stage, items: items.filter((i) => i.stage === stage) })),
  };
}

const card = (name: string) => within(screen.getByRole("article", { name }));

describe("the pipeline page (F5.2)", () => {
  it("groups roles by stage with how long, the next step, the flag, and both senders", async () => {
    fakeApi({ [`GET ${BASE}`]: pipeline([OFFER, SILENT, TWO_AGENCIES]) });
    renderInWorkspace(<PipelinePage workspaceId={W} />);
    await screen.findByRole("article", { name: "SRE · Umbrella" });
    const offer = within(screen.getByRole("region", { name: "Offer" }));
    expect(
      offer.getByRole("link", { name: "Platform Engineer · Globex" }).getAttribute("href"),
    ).toBe(`/w/${W}/inbox/${encodeURIComponent("<conf@globex>")}`);
    expect(offer.getByText("For 3 days · Next: Decide on the offer")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Interview" })).getByText("None"),
    ).toBeTruthy();

    const silent = card("SRE · Umbrella");
    expect(silent.getByRole("img", { name: "No reply for 21 days or more" })).toBeTruthy();
    expect(silent.getByText("For 25 days · Next: Follow up: no answer for 25 days")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Replied" })).getByText(/SRE/)).toBeTruthy();
    expect(card("Platform Engineer · Globex").queryByRole("img")).toBeNull();

    // The same role from two agencies: once, with both senders.
    expect(screen.getAllByRole("article", { name: "Backend Engineer · Hooli" })).toHaveLength(1);
    const both = card("Backend Engineer · Hooli");
    expect(both.getByText("From 2 senders: Anna, ben@randstad.example")).toBeTruthy();
    expect(both.getByText("Since today · Next: Decide whether to reply")).toBeTruthy();
  });

  it("says so when there are no roles yet", async () => {
    fakeApi({ [`GET ${BASE}`]: pipeline([]) });
    renderInWorkspace(<PipelinePage workspaceId={W} />);
    expect(await screen.findByText(/No roles yet/)).toBeTruthy();
  });
});

describe("setting a stage by hand (F5.1)", () => {
  it("moves a role, and puts it back to what the mail says", async () => {
    let current = pipeline([SILENT]);
    const seen = fakeApi({
      [`GET ${BASE}`]: () => current,
      [`PUT ${BASE}/stage`]: (req: FakeRequest) => {
        const body = req.body as { stage: PipelineItem["stage"] | null };
        const moved: PipelineItem =
          body.stage === null
            ? SILENT
            : {
                ...SILENT,
                stage: body.stage,
                stageSource: "you",
                noReply: false,
                since: daysAgo(0),
              };
        current = pipeline([moved]);
        return moved;
      },
    });
    renderInWorkspace(<PipelinePage workspaceId={W} />);
    const select = await screen.findByRole("combobox", { name: "Stage" });
    expect((select as HTMLSelectElement).value).toBe("derived");
    expect(within(select).getByRole("option", { name: "As the mail says (Replied)" })).toBeTruthy();

    await userEvent.selectOptions(select, "interview");
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Interview" })).getByText(/SRE/),
      ).toBeTruthy(),
    );
    expect(seen.filter((r) => r.method === "PUT").map((r) => r.body)).toEqual([
      { role: SILENT.role, stage: "interview" },
    ]);
    expect(card("SRE · Umbrella").getByText("Set by you")).toBeTruthy();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Stage" }), "derived");
    await waitFor(() =>
      expect(within(screen.getByRole("region", { name: "Replied" })).getByText(/SRE/)).toBeTruthy(),
    );
    expect(seen.filter((r) => r.method === "PUT").at(-1)?.body).toEqual({
      role: SILENT.role,
      stage: null,
    });
  });

  it("isn't offered to viewers", async () => {
    fakeApi({ [`GET ${BASE}`]: pipeline([SILENT]) });
    renderInWorkspace(<PipelinePage workspaceId={W} />, { role: "viewer" });
    await screen.findByRole("article", { name: "SRE · Umbrella" });
    expect(screen.queryByRole("combobox", { name: "Stage" })).toBeNull();
  });

  it("is shown in full to a member who sees the pipeline only", async () => {
    fakeApi({ [`GET ${BASE}`]: pipeline([OFFER, SILENT]) });
    renderInWorkspace(<PipelinePage workspaceId={W} />, {
      role: "editor",
      workspace: { scope: "pipeline" },
    });
    await screen.findByRole("article", { name: "SRE · Umbrella" });
    expect(screen.getByRole("article", { name: "Platform Engineer · Globex" })).toBeTruthy();
    expect(screen.getAllByRole("combobox", { name: "Stage" })).toHaveLength(2);
  });
});
