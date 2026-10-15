import { correctCategory, getRoles, getStoredMessages, saveEnvelopes } from "@jobfilly/db";
import type { MailClient } from "@jobfilly/mail";
import type { StageOneVerdict, Usage } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeAi,
  createFakeMailbox,
  createTestDeps,
  type FakeAiClient,
  type FakeMailbox,
  roleFacts,
  seedUser,
  type TestDeps,
} from "../testing";
import { type AnalysisRun, analyzeBatch, RunFailed } from "./analyze";

// Sorting and fact extraction, shared by the scan and the sync (pipeline/analyze.ts): one
// classify call per batch, one extract call per job message, corrections and job alerts kept,
// what a call can't be made for left pending, and a provider or mailbox that fails stops the run.

let deps: TestDeps;
let ws: string;
let mailbox: FakeMailbox;
let ai: FakeAiClient;
let mail: MailClient;

beforeEach(async () => {
  deps = await createTestDeps();
  ws = (await seedUser(deps)).workspaceId;
  mailbox = createFakeMailbox();
  ai = createFakeAi();
  mail = mailbox.port.connect(
    { host: "imap", port: 993, tlsMode: "tls", username: "maria", password: "p" },
    { allowInsecure: false },
  );
});
afterEach(() => deps.close());

async function stored(id: string, verdict: StageOneVerdict = "likely_job", text = "A role") {
  const envelope = mailbox.deliver({ messageId: id, text });
  await saveEnvelopes(deps.db, ws, [{ envelope, verdict, reason: null }]);
  return id;
}

const rows = (ids: string[]) =>
  getStoredMessages(deps.db, ws, ids).then((r) =>
    r.sort((a, b) => ids.indexOf(a.envelope.messageId) - ids.indexOf(b.envelope.messageId)),
  );

function run(budget = 100): AnalysisRun & { calls: number } {
  const r = {
    db: deps.db,
    workspaceId: ws,
    scanId: null,
    ai: ai.port.client({ provider: "openai", baseUrl: null, models: {} as never, apiKey: "k" }),
    mail,
    calls: 0,
    callsLeft: () => budget - r.calls,
    stopRequested: () => false,
    async call<T extends { usage: Usage[] }>(make: () => Promise<T>) {
      const result = await make();
      r.calls += result.usage.length;
      return result;
    },
  };
  return r;
}

describe("analyzeBatch", () => {
  it("classifies the batch in one call, then extracts each job message", async () => {
    const ids = [await stored("<a@x>"), await stored("<b@x>"), await stored("<c@x>")];
    ai.answers.classify = {
      "<a@x>": "recruiter_outreach",
      "<b@x>": "not_job",
      "<c@x>": "application_update",
    };
    ai.answers.extract = { "<a@x>": [roleFacts({ title: "Go" })], "<c@x>": [] };
    const outcome = await analyzeBatch(run(), await rows(ids));
    expect(outcome).toEqual({ analyzed: 3, jobs: ["<a@x>", "<c@x>"] });
    expect(ai.calls).toMatchObject({ classify: 1, extract: 2 });
    expect(await getRoles(deps.db, ws, "<a@x>")).toEqual([roleFacts({ title: "Go" })]);
    const byId = new Map((await rows(ids)).map((m) => [m.envelope.messageId, m]));
    expect(byId.get("<b@x>")).toMatchObject({ category: "not_job", analysisStatus: "done" });
    // The model read the body, fetched for it; nothing of it is stored.
    expect(mailbox.calls.fetchBody).toBe(3);
  });

  it("keeps a person's correction and a job alert without classifying them", async () => {
    const ids = [await stored("<a@x>"), await stored("<alert@x>", "job_alert")];
    await correctCategory(deps.db, ws, "<a@x>", "offer");
    ai.answers.extract = { "<a@x>": [], "<alert@x>": [roleFacts()] };
    const outcome = await analyzeBatch(run(), await rows(ids));
    expect(ai.calls.classify).toBe(0);
    expect(outcome.jobs).toEqual(["<a@x>", "<alert@x>"]);
    expect((await rows(["<a@x>"]))[0]).toMatchObject({ category: "offer", categorySource: "you" });
  });

  it("marks an invalid answer Couldn't analyze, and leaves what has no call left pending", async () => {
    const ids = [await stored("<a@x>"), await stored("<b@x>")];
    ai.answers.classify = { "<a@x>": "recruiter_outreach", "<b@x>": "recruiter_outreach" };
    ai.answers.extract = { "<a@x>": [] };
    ai.failNext("extract", "invalid_output");
    // Two calls: the classify call and one extract.
    const outcome = await analyzeBatch(run(2), await rows(ids));
    expect(outcome).toEqual({ analyzed: 1, jobs: [] });
    const byId = new Map((await rows(ids)).map((m) => [m.envelope.messageId, m.analysisStatus]));
    expect(Object.fromEntries(byId)).toEqual({ "<a@x>": "failed", "<b@x>": "pending" });
  });

  it("makes no call at all with no budget left", async () => {
    const ids = [await stored("<a@x>")];
    expect(await analyzeBatch(run(0), await rows(ids))).toEqual({ analyzed: 0, jobs: [] });
    expect(ai.log).toEqual([]);
  });

  it("stops the run when the provider fails, and when the mailbox can't be read", async () => {
    const ids = [await stored("<a@x>")];
    ai.failNext("classify", "unreachable");
    await expect(analyzeBatch(run(), await rows(ids))).rejects.toMatchObject({
      stopCause: "ai",
      code: "ai_unreachable",
    });
    mailbox.pause();
    const error = await analyzeBatch(run(), await rows(ids)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RunFailed);
    expect(error).toMatchObject({ stopCause: "mailbox", code: "mail_error" });
    expect((await rows(ids))[0]?.analysisStatus).toBe("pending");
  });
});
