import { createConfirmedProfile, liveDraftFor, type StoredDraft } from "@jobfilly/db";
import {
  type Cv,
  type DraftOutput,
  type DraftTaskInput,
  type JobFacts,
  type NeedSpec,
  PIPELINE_REEVALUATE_JOB,
  PipelineReevaluatePayloadSchema,
  type ProfileEntry,
} from "@jobfilly/schema";
import { type App, createApp } from "../app";
import { defineJob } from "../jobs/queue";
import { jobRegistry } from "../jobs/registry";
import { evaluateMessage } from "../pipeline/evaluate";
import { reevaluateWorkspace } from "../pipeline/reevaluate";
import { replyStage } from "../pipeline/reply";
import type { Stages } from "../pipeline/stages";
import {
  createFakeAi,
  createFakeMailbox,
  createTestDeps,
  type FakeAiClient,
  type FakeMailbox,
  recordingStages,
  roleFacts,
  type SeededUser,
  seedAiSettings,
  seedCv,
  seedJobMail,
  seedMailbox,
  seedUser,
  signedIn,
  TEST_AI_MODELS,
  type TestClient,
  type TestDeps,
} from "../testing";

// The replies slice's test setup (tests only): Maria's workspace with a mailbox, AI settings and
// a confirmed profile holding an EUR minimum, the fake mailbox and the fake AI, and pipeline
// stages that record the sender check and answer the CV choice and the match as each test says,
// with the real reply stage. pipeline.reevaluate runs these same stages, so a change (a rule, a
// decision answer) goes through the reply stage like it does in the app.

export const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

export const EUR_MIN = {
  amount: 70000,
  currency: "EUR",
  period: "year" as const,
  asWritten: "70k EUR",
};

export const CHF_NEED: NeedSpec = {
  groupKey: "min_pay:CHF:year",
  profileKey: "min_pay",
  question: "Minimum pay in CHF per year?",
  choices: [
    {
      label: "CHF 120,000",
      value: { amount: 120000, currency: "CHF", period: "year", asWritten: "CHF 120,000" },
    },
  ],
};

/** How the recording match stage evaluates one role. */
export interface RoleSetup {
  score?: number;
  needs?: NeedSpec[];
  cvId?: string | null;
}

export const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "scan",
  updatedAt: NOW.toISOString(),
  updatedBy: null,
});

/** A draft.v1 answer: an English reply unless told otherwise. */
export function draftAnswer(overrides: Partial<DraftOutput> = {}): DraftOutput {
  return {
    subject: "Re: A role for you",
    body: "Hello Jonas,\n\nthank you, the role sounds like a good fit. I'd like to hear more.\n\nMaria",
    language: "en",
    usedEntries: ["target_roles"],
    attachCv: false,
    questions: [],
    ...overrides,
  };
}

export interface Harness {
  deps: TestDeps;
  app: App;
  mailbox: FakeMailbox;
  ai: FakeAiClient;
  /** Every draft.v1 input the fake AI got, in order. */
  draftInputs: DraftTaskInput[];
  maria: SeededUser;
  ws: string;
  profileId: string;
  stages: Stages;
  /** How each role is evaluated, by "<Message-ID>#<position>". */
  roles: Map<string, RoleSetup>;
  /** A job message in the mailbox and the database, with the setup of its roles. */
  deliver(
    messageId: string,
    input?: {
      receivedAt?: Date;
      text?: string;
      subject?: string;
      references?: string[];
      roles?: (RoleSetup & { facts?: Partial<JobFacts> })[];
    },
  ): Promise<void>;
  /** The inline evaluation a sync makes of new mail. */
  evaluate(messageId: string): ReturnType<typeof evaluateMessage>;
  /** Runs queued jobs (re-evaluations, draft.create) until none is left. */
  drain(): Promise<number>;
  live(messageId: string, position?: number): Promise<StoredDraft | null>;
  cv(name: string, language: string): Promise<Cv>;
  client(user?: { id: string }): Promise<TestClient>;
  close(): Promise<void>;
}

export async function createHarness(options: { entries?: ProfileEntry[] } = {}): Promise<Harness> {
  const roles = new Map<string, RoleSetup>();
  const recording = recordingStages();
  recording.score = (id, position) => roles.get(`${id}#${position}`)?.score ?? 80;
  const stages: Stages = {
    sender: recording.sender,
    async cvChoice(input, ctx) {
      const choice = await recording.cvChoice(input, ctx);
      const cvId = roles.get(`${input.message.messageId}#${input.role.position}`)?.cvId ?? null;
      return { ...choice, cvId, reason: cvId ? "Chosen for the test" : choice.reason };
    },
    async match(input, ctx) {
      const evaluation = await recording.match(input, ctx);
      const setup = roles.get(`${input.message.messageId}#${input.role.position}`);
      const verdicts = (setup?.needs ?? []).map((need) => ({
        entryKey: need.profileKey,
        ruleId: null,
        verdict: "unknown" as const,
        reason: "different currency",
        hard: false,
        need,
      }));
      return evaluation.match
        ? { ...evaluation, match: { ...evaluation.match, verdicts } }
        : evaluation;
    },
    reply: replyStage,
  };

  const deps = await createTestDeps({
    now: NOW,
    registry: {
      ...jobRegistry,
      [PIPELINE_REEVALUATE_JOB]: defineJob(PipelineReevaluatePayloadSchema, (ctx) =>
        reevaluateWorkspace(ctx.deps, ctx.payload.workspaceId, {
          stages,
          signal: ctx.signal,
        }).then(() => {}),
      ),
    },
  });
  const mailbox = createFakeMailbox();
  deps.mail = mailbox.port;
  const ai = createFakeAi();
  const draftInputs: DraftTaskInput[] = [];
  deps.ai = {
    client(settings) {
      const client = ai.port.client(settings);
      return {
        ...client,
        draft(input, options) {
          draftInputs.push(structuredClone(input));
          return client.draft(input, options);
        },
      };
    },
  };
  const maria = await seedUser(deps, { name: "Maria Santos" });
  const ws = maria.workspaceId;
  await seedMailbox(deps, ws, {
    address: "maria.santos@inbox.example",
    conn: { host: "imap", port: 3143, tlsMode: "tls", username: "maria", password: "E2E-SECRET-p" },
    sentFolderPath: "Sent",
  });
  await seedAiSettings(deps, ws, {
    provider: "openai-compatible",
    baseUrl: "http://fake-ai.test/v1",
    models: TEST_AI_MODELS,
    apiKey: "E2E-SECRET-ai",
  });
  const created = await createConfirmedProfile(deps.db, ws, {
    name: "My job search",
    entries: options.entries ?? [
      entry("target_roles", ["Backend engineer"]),
      entry("min_pay", [EUR_MIN]),
    ],
    createdBy: maria.id,
    at: NOW,
  });
  if (!created.ok) throw new Error("harness: no profile");
  const app = createApp(deps);

  return {
    deps,
    app,
    mailbox,
    ai,
    draftInputs,
    maria,
    ws,
    profileId: created.profile.id,
    stages,
    roles,
    async deliver(messageId, input = {}) {
      const setups = input.roles ?? [{}];
      setups.forEach((setup, position) => {
        roles.set(`${messageId}#${position}`, setup);
      });
      const envelope = await seedJobMail(deps, ws, mailbox, {
        messageId,
        receivedAt: input.receivedAt ?? daysAgo(1),
        subject: input.subject ?? "A role for you",
        text: input.text ?? "Hello Maria, a backend role for you. Could you send your CV?",
        roles: setups.map((s) => roleFacts(s.facts ?? {})),
      });
      if (input.references) {
        const stored = mailbox.messages("inbox").find((m) => m.uid === envelope.uid);
        if (stored) stored.envelope.references = input.references;
      }
    },
    evaluate: (messageId) => evaluateMessage(deps, ws, messageId, { origin: "new", stages }),
    async drain() {
      let ran = 0;
      while (await deps.queue.runOnce()) ran += 1;
      return ran;
    },
    live: (messageId, position = 0) => liveDraftFor(deps.db, ws, { messageId, position }),
    cv: (name, language) =>
      seedCv(deps, ws, {
        name,
        language,
        skills: ["Go", "PostgreSQL"],
        text: `${name}\nGo, PostgreSQL`,
        profileId: created.profile.id,
      }),
    client: (user = maria) => signedIn(app, deps, user),
    close: () => deps.close(),
  };
}
