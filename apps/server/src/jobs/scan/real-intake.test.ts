import { aggregateIntake } from "@jobfilly/core";
import { getScan, loadIntakeInput } from "@jobfilly/db";
import {
  CORE_PROFILE_KEYS,
  CurrentScanSchema,
  type Envelope,
  type JobFacts,
  NOT_ENOUGH_EVIDENCE,
  type Preferences,
} from "@jobfilly/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { MINUTE } from "../../clock";
import {
  createTestDeps,
  type SeededUser,
  seedAiSettings,
  seedMailbox,
  seedUser,
  signedIn,
  type TestClient,
  type TestDeps,
} from "../../testing";
import { type FakeAiAnswers, fakeAi, fakeMail } from "./fakes";

// The scan with the real intake aggregation (packages/core), as production wires it: the app's
// own deps, job registry and routes, with only the mailbox and the model faked. The scan tests
// next door use a stand-in aggregation to control the stop; this file proves the real one drives
// the scan to the stops F4.4 promises (S3, S7) instead of failing the job.

/** Whole scans against PGlite; on a busy machine that takes a while. */
const SLOW = 120_000;
const NOW = new Date("2026-10-01T10:00:00Z");

let deps: TestDeps | undefined;
afterEach(async () => {
  await deps?.close();
  deps = undefined;
});

interface Person {
  name: string;
  address: string;
}
const MARIA: Person = { name: "Maria Santos", address: "maria.santos@inbox.example" };
const TOM: Person = { name: "Tom Okafor", address: "tom.okafor@inbox.example" };

let uid = 0;
function mail(me: Person, minutesAgo: number, overrides: Partial<Envelope> = {}): Envelope {
  uid += 1;
  const folder = overrides.folder ?? "inbox";
  return {
    messageId: `<real-intake-${uid}@agency.example>`,
    folder,
    folderPath: folder === "inbox" ? "INBOX" : "Sent",
    uidValidity: 3,
    uid,
    date: new Date(NOW.getTime() - minutesAgo * MINUTE).toISOString(),
    from: { address: `recruiter${uid}@agency.example`, name: `Recruiter ${uid}` },
    to: [{ address: me.address, name: me.name }],
    cc: [],
    replyTo: [],
    inReplyTo: null,
    references: [],
    subject: `A backend role for you ${uid}`,
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    autoSubmitted: null,
    snippet: `Hello, a backend role ${uid}`,
    ...overrides,
  };
}

const replyTo = (me: Person, original: Envelope, minutesAgo: number) =>
  mail(me, minutesAgo, {
    folder: "sent",
    from: { address: me.address, name: me.name },
    to: [original.from],
    inReplyTo: original.messageId,
  });

const role = (overrides: Partial<JobFacts>): JobFacts => ({
  title: null,
  company: null,
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
});

/** What Maria's replies keep saying: every reply states the same, so each answer is firm. */
const MARIA_PREFS: Preferences = {
  target_roles: ["Backend Engineer"],
  places: [{ country: "DE", city: "Berlin", mode: "hybrid" }],
  min_pay: [{ amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" }],
  languages: ["English"],
};

async function setup(me: Person, envelopes: Envelope[], answers: FakeAiAnswers) {
  // The app's own registry and intake wiring: nothing here replaces deps.intake.
  const d = await createTestDeps({ now: NOW });
  deps = d;
  const app = createApp(d);
  const user: SeededUser = await seedUser(d, { name: me.name, email: me.address });
  await seedMailbox(d, user.workspaceId, {
    address: me.address,
    conn: { host: "imap.test", port: 993, tlsMode: "tls", username: me.address, password: "pw" },
    sentFolderPath: "Sent",
  });
  await seedAiSettings(d, user.workspaceId, {
    provider: "openai-compatible",
    baseUrl: "http://fake-ai.test/v1",
    models: {
      classify: "m",
      extract: "m",
      prefs: "m",
      intake: "m",
      cv: "m",
      match: "m",
      draft: "m",
      assistant: "m",
    },
    apiKey: "key",
    budgetPerRun: 300,
  });
  d.mail = fakeMail(envelopes).port;
  d.ai = fakeAi(answers).port;
  const client: TestClient = await signedIn(app, d, user);
  const scans = `/api/workspaces/${user.workspaceId}/scans`;
  return {
    d,
    workspaceId: user.workspaceId,
    /** Starts the first scan over HTTP and runs the queue until nothing is left to run. */
    async scan() {
      expect((await client.post(scans)).status).toBe(201);
      while (await d.queue.runOnce()) {}
      const res = await client.get(`${scans}/current`);
      expect(res.status).toBe(200);
      return CurrentScanSchema.parse(await res.json());
    },
  };
}

const logs = (d: TestDeps, event: string) => d.logs.filter((l) => l.event === event);

describe("the first scan with the real intake aggregation", { timeout: SLOW }, () => {
  it("is wired as production wires it", async () => {
    deps = await createTestDeps();
    expect(deps.intake.aggregate).toBe(aggregateIntake);
  });

  it("stops as confident on a Maria-like mailbox, with likely mail left and no failed job", async () => {
    const recruiters = Array.from({ length: 100 }, (_, i) => mail(MARIA, 60 * (i + 1)));
    const replies = [0, 1, 2].map((i) => replyTo(MARIA, recruiters[i] as Envelope, 30 + 60 * i));
    const replyIds = new Set(replies.map((r) => r.messageId));
    const notJob = new Set(recruiters.filter((_, i) => i % 5 === 4).map((e) => e.messageId));
    const s = await setup(MARIA, [...recruiters, ...replies], {
      prefs: (id) => (replyIds.has(id) ? MARIA_PREFS : {}),
      classify: (id) => (notJob.has(id) ? "not_job" : "recruiter_outreach"),
      // What job mail offers: titles differ, but seniority and the contract recur.
      extract: (id) => [
        role({
          title: `Backend role ${id}`,
          company: "Agency",
          places: [{ country: "DE", city: "Berlin" }],
          workMode: "hybrid",
          seniority: "Senior",
          contract: "B2B",
        }),
      ],
    });

    const current = await s.scan();
    expect(current.progress).toMatchObject({ status: "stopped", stopReason: "confident" });
    const progress = current.progress;
    expect(progress?.notAnalyzed).toBeGreaterThan(0);
    expect(progress?.analyzed).toBeLessThan(progress?.likely ?? 0);
    expect(logs(s.d, "job.failed")).toEqual([]);
    expect(logs(s.d, "scan.batch_completed").map((l) => l.kind)).toEqual(
      expect.arrayContaining(["replies", "candidates"]),
    );
    expect(logs(s.d, "scan.stopped")).toEqual([
      expect.objectContaining({ level: "info", reason: "confident" }),
    ]);
    // Stopped, not failed: no cause, and the stop is dated as this run's.
    expect(current.stopMessage).not.toBeNull();
    expect(current.stoppedAt).toBe(NOW.toISOString());
    expect(logs(s.d, "scan.stopped")[0]).not.toHaveProperty("stopCause");

    // The answers the scan stopped on: the replies' own, and what job mail keeps offering.
    const scan = await getScan(s.d.db, s.workspaceId, progress?.scanId ?? "");
    expect(scan).toMatchObject({ stopReason: "confident", stopCause: null });
    const proposal = aggregateIntake(await loadIntakeInput(s.d.db, s.workspaceId));
    const byKey = new Map(proposal.entries.map((e) => [e.key, e]));
    expect(byKey.get("target_roles")).toMatchObject({
      value: ["Backend Engineer"],
      confidence: "high",
    });
    expect(
      byKey
        .get("target_roles")
        ?.evidence.map((e) => e.messageId)
        .sort(),
    ).toEqual([...replyIds].sort());
    expect(byKey.get("seniority")).toMatchObject({ value: ["Senior"], confidence: "medium" });
    expect(byKey.get("contracts")).toMatchObject({ value: ["B2B"], confidence: "medium" });
    expect(byKey.get("deal_breakers")).toMatchObject({ emptyReason: NOT_ENOUGH_EVIDENCE });
    expect(scan?.counts.answersFirm).toBe(6);
  });

  it("stops as done on a thin, Tom-like mailbox, with nothing to propose", async () => {
    const recruiters = Array.from({ length: 6 }, (_, i) =>
      mail(TOM, 24 * 60 * (i + 1), { to: [{ address: TOM.address, name: TOM.name }] }),
    );
    const s = await setup(TOM, recruiters, {
      prefs: () => ({}),
      classify: () => "recruiter_outreach",
      extract: (id) => [role({ title: `Role ${id}` })],
    });

    const current = await s.scan();
    expect(current.progress).toMatchObject({
      status: "stopped",
      stopReason: "done",
      likely: 6,
      analyzed: 6,
      notAnalyzed: 0,
    });
    expect(logs(s.d, "job.failed")).toEqual([]);
    expect(logs(s.d, "scan.batch_completed").length).toBeGreaterThan(0);
    expect(logs(s.d, "scan.stopped")).toEqual([
      expect.objectContaining({ level: "info", reason: "done" }),
    ]);
    expect(current.stoppedAt).toBe(NOW.toISOString());
    const scan = await getScan(s.d.db, s.workspaceId, current.progress?.scanId ?? "");
    expect(scan).toMatchObject({ stopReason: "done", stopCause: null });
    const proposal = aggregateIntake(await loadIntakeInput(s.d.db, s.workspaceId));
    expect(proposal.entries.map((e) => e.key)).toEqual([...CORE_PROFILE_KEYS]);
    for (const entry of proposal.entries) {
      expect(entry, entry.key).toMatchObject({
        value: [],
        confidence: null,
        emptyReason: NOT_ENOUGH_EVIDENCE,
      });
    }
  });
});
