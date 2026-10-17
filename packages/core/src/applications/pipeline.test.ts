import type { ApplicationStage, Category, JobFacts, Pipeline } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import {
  buildPipeline,
  type PipelineInput,
  type PipelineMailInput,
  type PipelineRoleInput,
} from "./index";

// The application pipeline (F5.1–F5.3): stages derived from the thread's mail, a stage set by hand
// winning, how long a role has been in its stage, the next step, the 21-day flag, and the same
// role from two agencies as one item with both senders.

const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function facts(overrides: Partial<JobFacts> = {}): JobFacts {
  return {
    title: "Backend Engineer",
    company: "Globex",
    agency: null,
    places: [],
    workMode: null,
    remoteScope: null,
    timeZones: null,
    pay: null,
    contract: null,
    seniority: null,
    workPermit: null,
    skills: [],
    languages: [],
    applyUrl: null,
    extra: {},
    ...overrides,
  };
}

function role(
  messageId: string,
  at: Date,
  overrides: { position?: number; facts?: Partial<JobFacts>; from?: string } = {},
): PipelineRoleInput {
  return {
    messageId,
    position: overrides.position ?? 0,
    facts: facts(overrides.facts),
    from: { address: overrides.from ?? "talent@globex.example", name: null },
    receivedAt: at,
  };
}

function mail(
  messageId: string,
  at: Date,
  input: {
    category?: Category | null;
    own?: boolean;
    replyTo?: string;
    references?: string[];
  } = {},
): PipelineMailInput {
  return {
    messageId,
    inReplyTo: input.replyTo ?? null,
    references: input.references ?? [],
    receivedAt: at,
    category: input.category === undefined ? "recruiter_outreach" : input.category,
    own: input.own ?? false,
  };
}

const empty: PipelineInput = { roles: [], mail: [], sent: [], manual: [] };

function items(pipeline: Pipeline) {
  return pipeline.stages.flatMap((s) => s.items);
}
function only(pipeline: Pipeline) {
  const all = items(pipeline);
  expect(all).toHaveLength(1);
  const [item] = all;
  if (!item) throw new Error("no item");
  return item;
}
const stageOf = (input: Partial<PipelineInput>) =>
  only(buildPipeline({ ...empty, ...input }, NOW)).stage;

describe("the stage of a role (F5.1)", () => {
  it("is new for a role nobody answered, since its mail came", () => {
    const item = only(
      buildPipeline(
        { ...empty, roles: [role("<a>", daysAgo(3))], mail: [mail("<a>", daysAgo(3))] },
        NOW,
      ),
    );
    expect(item).toMatchObject({
      stage: "new",
      stageSource: "derived",
      since: daysAgo(3).toISOString(),
      nextStep: "Decide whether to reply",
      noReply: false,
      title: "Backend Engineer",
      company: "Globex",
    });
  });

  it("follows the thread: confirmation → interview invite → offer", () => {
    const thread = [
      mail("<conf>", daysAgo(20), { category: "application_update" }),
      mail("<inv>", daysAgo(12), { category: "interview", replyTo: "<conf>" }),
      mail("<offer>", daysAgo(2), {
        category: "offer",
        replyTo: "<inv>",
        references: ["<conf>", "<inv>"],
      }),
    ];
    const roles = [role("<conf>", daysAgo(20))];
    expect(stageOf({ roles, mail: thread.slice(0, 1) })).toBe("applied");
    // An interview invite moves it to interview.
    const interview = only(buildPipeline({ ...empty, roles, mail: thread.slice(0, 2) }, NOW));
    expect(interview).toMatchObject({
      stage: "interview",
      since: daysAgo(12).toISOString(),
      nextStep: "Prepare for the interview",
    });
    const offer = only(buildPipeline({ ...empty, roles, mail: thread }, NOW));
    expect(offer).toMatchObject({ stage: "offer", since: daysAgo(2).toISOString() });
  });

  it("reads each category that names a stage", () => {
    const cases: [Category, ApplicationStage][] = [
      ["application_update", "applied"],
      ["interview", "interview"],
      ["assessment", "assessment"],
      ["offer", "offer"],
      ["rejection", "rejected"],
      ["other_job", "new"],
      ["recruiter_outreach", "new"],
    ];
    for (const [category, stage] of cases) {
      const input = {
        roles: [role("<a>", daysAgo(5))],
        mail: [mail("<a>", daysAgo(5)), mail("<b>", daysAgo(1), { category, replyTo: "<a>" })],
      };
      expect([category, stageOf(input)]).toEqual([category, stage]);
    }
  });

  it("is replied once the user answered, from the mailbox or sent from the app", () => {
    const roles = [role("<a>", daysAgo(5))];
    const own = mail("<re>", daysAgo(4), { own: true, category: null, replyTo: "<a>" });
    expect(stageOf({ roles, mail: [mail("<a>", daysAgo(5)), own] })).toBe("replied");
    const sent = [{ messageId: "<a>", position: 0, sentAt: daysAgo(3) }];
    const item = only(
      buildPipeline({ ...empty, roles, mail: [mail("<a>", daysAgo(5))], sent }, NOW),
    );
    expect(item).toMatchObject({ stage: "replied", since: daysAgo(3).toISOString() });
  });

  it("never moves back for a reply or an application update, but a rejection ends it", () => {
    const roles = [role("<a>", daysAgo(10))];
    const base = [
      mail("<a>", daysAgo(10), { category: "interview" }),
      mail("<re>", daysAgo(9), { own: true, category: null, replyTo: "<a>" }),
      mail("<upd>", daysAgo(8), { category: "application_update", replyTo: "<re>" }),
    ];
    const item = only(buildPipeline({ ...empty, roles, mail: base }, NOW));
    expect(item).toMatchObject({ stage: "interview", since: daysAgo(10).toISOString() });
    const rejected = [
      ...base,
      mail("<no>", daysAgo(1), { category: "rejection", replyTo: "<upd>" }),
    ];
    expect(stageOf({ roles, mail: rejected })).toBe("rejected");
  });

  it("joins a reply whose parent isn't stored to the rest of its thread", () => {
    const roles = [role("<a>", daysAgo(10))];
    const thread = [
      mail("<a>", daysAgo(10), { references: ["<lost>"] }),
      mail("<inv>", daysAgo(1), { category: "interview", references: ["<lost>"] }),
    ];
    expect(stageOf({ roles, mail: thread })).toBe("interview");
  });

  it("isn't moved by mail of another thread", () => {
    const roles = [role("<a>", daysAgo(10))];
    const other = mail("<x>", daysAgo(1), { category: "offer" });
    expect(stageOf({ roles, mail: [mail("<a>", daysAgo(10)), other] })).toBe("new");
  });

  it("wins when set by hand, whatever mail comes after, until it is cleared", () => {
    const roles = [role("<a>", daysAgo(10))];
    const thread = [
      mail("<a>", daysAgo(10)),
      mail("<no>", daysAgo(1), { category: "rejection", replyTo: "<a>" }),
    ];
    const manual = [
      { messageId: "<a>", position: 0, stage: "interview" as const, setAt: daysAgo(3) },
    ];
    const item = only(buildPipeline({ ...empty, roles, mail: thread, manual }, NOW));
    expect(item).toMatchObject({
      stage: "interview",
      stageSource: "you",
      since: daysAgo(3).toISOString(),
    });
    expect(stageOf({ roles, mail: thread })).toBe("rejected");
  });
});

describe("the pipeline view (F5.2)", () => {
  it("groups every role by stage in the stages' order, the latest move first", () => {
    const pipeline = buildPipeline(
      {
        ...empty,
        roles: [
          role("<a>", daysAgo(9), { facts: { title: "A" } }),
          role("<b>", daysAgo(5), { facts: { title: "B" } }),
          role("<c>", daysAgo(4), { facts: { title: "C" } }),
        ],
        mail: [
          mail("<a>", daysAgo(9)),
          mail("<b>", daysAgo(5)),
          mail("<c>", daysAgo(4), { category: "offer" }),
        ],
      },
      NOW,
    );
    expect(pipeline.stages.map((s) => s.stage)).toEqual([
      "new",
      "replied",
      "applied",
      "interview",
      "assessment",
      "offer",
      "rejected",
      "closed",
    ]);
    expect(pipeline.stages[0]?.items.map((i) => i.title)).toEqual(["B", "A"]);
    expect(pipeline.stages[5]?.items.map((i) => i.title)).toEqual(["C"]);
  });

  it("flags an application with no answer for 21 days, not before", () => {
    const roles = [role("<a>", daysAgo(30))];
    const thread = (days: number) => [
      mail("<a>", daysAgo(30)),
      mail("<app>", daysAgo(days), { own: true, category: null, replyTo: "<a>" }),
    ];
    const silent = only(buildPipeline({ ...empty, roles, mail: thread(25) }, NOW));
    expect(silent).toMatchObject({
      stage: "replied",
      noReply: true,
      nextStep: "Follow up: no answer for 25 days",
    });
    expect(only(buildPipeline({ ...empty, roles, mail: thread(21) }, NOW)).noReply).toBe(true);
    expect(only(buildPipeline({ ...empty, roles, mail: thread(20) }, NOW))).toMatchObject({
      noReply: false,
      nextStep: "Wait for their answer",
    });
  });

  it("flags a confirmed application nobody followed up on", () => {
    const roles = [role("<conf>", daysAgo(25))];
    const confirmed = [mail("<conf>", daysAgo(25), { category: "application_update" })];
    expect(only(buildPipeline({ ...empty, roles, mail: confirmed }, NOW)).noReply).toBe(true);
  });

  it("doesn't flag when they answered last, or when nothing is open", () => {
    const roles = [role("<a>", daysAgo(40))];
    const answered = [
      mail("<a>", daysAgo(40)),
      mail("<re>", daysAgo(35), { own: true, category: null, replyTo: "<a>" }),
      mail("<them>", daysAgo(30), { category: "other_job", replyTo: "<re>" }),
    ];
    expect(only(buildPipeline({ ...empty, roles, mail: answered }, NOW))).toMatchObject({
      stage: "replied",
      noReply: false,
    });
    // A new role is the user's turn, not a silence.
    expect(
      only(buildPipeline({ ...empty, roles, mail: [mail("<a>", daysAgo(40))] }, NOW)).noReply,
    ).toBe(false);
    const rejected = [
      ...answered,
      mail("<no>", daysAgo(29), { category: "rejection", replyTo: "<them>" }),
    ];
    expect(only(buildPipeline({ ...empty, roles, mail: rejected }, NOW)).noReply).toBe(false);
  });

  it("counts a stage set by hand to applied as the user's move", () => {
    const roles = [role("<a>", daysAgo(40))];
    const manual = [
      { messageId: "<a>", position: 0, stage: "applied" as const, setAt: daysAgo(22) },
    ];
    const item = only(
      buildPipeline({ ...empty, roles, mail: [mail("<a>", daysAgo(40))], manual }, NOW),
    );
    expect(item).toMatchObject({ stage: "applied", stageSource: "you", noReply: true });
  });
});

describe("the same role from two agencies (F5.3)", () => {
  it("is one item with both senders, the client named as the company", () => {
    const roles = [
      role("<one>", daysAgo(6), {
        facts: {
          title: "Senior Backend Engineer",
          company: null,
          agency: { name: "Hays", client: "Initech" },
        },
        from: "anna@hays.example",
      }),
      role("<two>", daysAgo(4), {
        facts: { title: "senior backend engineer ", company: "INITECH", agency: null },
        from: "ben@randstad.example",
      }),
    ];
    const item = only(
      buildPipeline(
        { ...empty, roles, mail: [mail("<one>", daysAgo(6)), mail("<two>", daysAgo(4))] },
        NOW,
      ),
    );
    expect(item).toMatchObject({
      role: { messageId: "<one>", position: 0 },
      roles: [
        { messageId: "<one>", position: 0 },
        { messageId: "<two>", position: 0 },
      ],
      title: "Senior Backend Engineer",
      company: "Initech",
      senders: [
        { address: "anna@hays.example", name: null },
        { address: "ben@randstad.example", name: null },
      ],
    });
  });

  it("takes its stage from both threads, and a change by hand on either role", () => {
    const roles = [
      role("<one>", daysAgo(6), { from: "a@x.example" }),
      role("<two>", daysAgo(4), { from: "b@y.example" }),
    ];
    const mailOf = [
      mail("<one>", daysAgo(6)),
      mail("<two>", daysAgo(4)),
      mail("<inv>", daysAgo(1), { category: "interview", replyTo: "<two>" }),
    ];
    expect(stageOf({ roles, mail: mailOf })).toBe("interview");
    const manual = [
      { messageId: "<two>", position: 0, stage: "closed" as const, setAt: daysAgo(0) },
    ];
    expect(stageOf({ roles, mail: mailOf, manual })).toBe("closed");
  });

  it("keeps different roles apart, those of one message too", () => {
    const pipeline = buildPipeline(
      {
        ...empty,
        roles: [
          role("<a>", daysAgo(3), { position: 0, facts: { title: null } }),
          role("<a>", daysAgo(3), { position: 1, facts: { title: null } }),
          role("<b>", daysAgo(2), { facts: { title: "Data Engineer" } }),
          role("<c>", daysAgo(2), { facts: { title: "Data Engineer", company: "Umbrella" } }),
        ],
        mail: [mail("<a>", daysAgo(3)), mail("<b>", daysAgo(2)), mail("<c>", daysAgo(2))],
      },
      NOW,
    );
    expect(items(pipeline)).toHaveLength(4);
  });

  it("counts a role restated without its title later in the thread as the same one", () => {
    const roles = [
      role("<conf>", daysAgo(9)),
      role("<inv>", daysAgo(2), { facts: { title: null, company: null } }),
    ];
    const thread = [
      mail("<conf>", daysAgo(9), { category: "application_update" }),
      mail("<inv>", daysAgo(2), { category: "interview", replyTo: "<conf>" }),
    ];
    const item = only(buildPipeline({ ...empty, roles, mail: thread }, NOW));
    expect(item).toMatchObject({ stage: "interview", title: "Backend Engineer" });
    expect(item.roles).toHaveLength(2);
  });
});
