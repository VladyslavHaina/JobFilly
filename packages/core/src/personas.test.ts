import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type Category,
  CategorySchema,
  CvReadOutputSchema,
  DraftOutputSchema,
  type JobFacts,
  JobFactsSchema,
  type MatchAiOutput,
  MatchAiOutputSchema,
  type ProfileEntry,
  ProfileEntrySchema,
  type RdapLookupResult,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { type CvCandidate, chooseCv, tagsAfterRead } from "./cv/index";
import {
  answerChange,
  answerOf,
  needsFromQuestions,
  planReply,
  type RoleNeed,
  roleNeeds,
} from "./decisions/index";
import { findPlaceholders } from "./drafts/index";
import { matchRole, matchTaskInput, needsMatchAi } from "./match/index";
import { withinReplyWindow } from "./policy/index";
import { applyChanges } from "./profile/index";
import {
  checkSender,
  type DomainFacts,
  detectLanguage,
  isFreeMailDomain,
  senderDomain,
} from "./sender/index";

// The real engine against the personas' ground truth (TBD-414): every job message of the test
// stack's fixtures (e2e/fixtures/<persona>), the first scan's backlog and the mail MVP 2 delivers,
// goes through what the server's pipeline runs on it — the sender check, the CV choice, the
// rules and the match with the fake AI's match.v1 answer, the needs and the reply plan — and what
// comes out is compared with expected.json. expected.json is written by hand in the persona
// sources (e2e/fixtures/build), never by a copy of this engine, so a change here that moves a
// verdict, a hard conflict, a CV choice, a fit or a decision away from the ground truth fails.
//
// The inputs are the fixtures' as the test stack serves them: the facts and categories the fake
// AI's extract and classify answers give (expected.json holds the same), the CVs as cv.v1 reads
// them with the preferred mark Maria gives Backend (EN) in MVP 2 S1, the domain ages the fake
// RDAP service serves (e2e/rdap/domains.json; every sender domain also has an MX record), and the
// profile each persona has when MVP 2 starts: her confirmed intake, with Amsterdam removed in
// MVP 1 S4. The tests read the fixtures with node:fs, as sender/fixtures.test.ts does.

const FIXTURES = fileURLToPath(new URL("../../../e2e/fixtures/", import.meta.url));
const E2E = fileURLToPath(new URL("../../../e2e/", import.meta.url));
const readText = (path: string): string => readFileSync(path, "utf8");
const readJson = <T>(path: string): T => JSON.parse(readText(path)) as T;

/** The time the fixtures' Date headers are written against (e2e/fixtures/format.ts). */
const NOW = new Date("2026-10-01T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

interface ExpectedRole {
  cv: string | null;
  hardConflicts: string[];
  draft: boolean;
  fit?: "good" | "below" | "capped";
  needs?: string[];
}
interface ExpectedMessage {
  category: string | null;
  facts: unknown[] | null;
  sender?: { verdict: string };
  outsideReplyWindow?: boolean;
  roles?: ExpectedRole[];
}
interface ExpectedFile {
  messages: Record<string, ExpectedMessage>;
  deliveries: Record<string, ExpectedMessage>;
  profile: { answers: Record<string, { values: unknown[] }> };
  cvs: { name: string; tags: string[]; skills: string[] }[];
}
interface Envelope {
  file: string;
  messageId: string;
  minutesAgo: number;
  from: { address: string; name: string | null };
  subject: string;
}
interface Delivery {
  file: string;
  messageId: string;
  minutesAgo: number;
  /** The scenario step that delivers it: S2 the batch, S5 the second Zurich role. */
  step: "S2" | "S5";
}
interface CvFile {
  name: string;
  contentHash: string;
}

const PERSONAS = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`${FIXTURES}${d.name}/expected.json`))
  .map((d) => d.name)
  .sort();

/** Decodes quoted-printable text (ASCII on the wire) to UTF-8, by way of percent-encoding. */
function decodeQp(data: string): string {
  return decodeURIComponent(
    data
      .replace(/=\r?\n/g, "")
      .replace(/%/g, "%25")
      .replace(/=([0-9A-F]{2})/g, "%$1"),
  );
}

/** The text/plain part of a fixture .eml (multipart/alternative, quoted-printable). */
function plainText(raw: string): string {
  for (const part of raw.split(/\r\n--[^\r\n]+\r\n/)) {
    const end = part.indexOf("\r\n\r\n");
    if (/^Content-Type: text\/plain/im.test(part.slice(0, end)))
      return decodeQp(part.slice(end + 4));
  }
  throw new Error("no text/plain part");
}

/** A header of a fixture .eml, unfolded; "" when it has none. */
function header(raw: string, name: string): string {
  const head = raw.slice(0, raw.indexOf("\r\n\r\n")).replace(/\r\n[ \t]+/g, " ");
  return new RegExp(`^${name}: (.*)$`, "im").exec(head)?.[1] ?? "";
}

/** A header's RFC 2047 encoded words (=?UTF-8?B?…?= or Q) as text. */
function decodeWords(value: string): string {
  return value.replace(/=\?utf-8\?([bq])\?([^?]*)\?=\s*/gi, (_, enc: string, data: string) =>
    enc.toLowerCase() === "b"
      ? Buffer.from(data, "base64").toString("utf8")
      : decodeQp(data.replace(/_/g, " ")),
  );
}

/** The address of a From header: `"Name" <a@b>` or `a@b`. */
function fromAddress(raw: string): string {
  const from = header(raw, "From");
  return /<([^>]+)>/.exec(from)?.[1] ?? from.trim();
}

/** One job message as the pipeline sees it. */
interface JobMessage {
  persona: string;
  messageId: string;
  delivered: boolean;
  /** When it reaches the pipeline: with the first scan, or delivered in S2 or S5. */
  step: "backlog" | "S2" | "S5";
  from: string;
  subject: string;
  text: string;
  receivedAt: Date;
  truth: ExpectedMessage;
}

/** The fake RDAP service's domain ages and the DNS zones' MX records, as the server reads them. */
const RDAP = readJson<{ domains: Record<string, { registeredDaysAgo: number }> }>(
  `${E2E}rdap/domains.json`,
).domains;

function domainFacts(address: string): DomainFacts {
  const domain = senderDomain(address);
  // The sender stage looks up neither a free-mail provider's domain nor an address without one.
  if (!domain || isFreeMailDomain(domain)) return { rdap: null, mx: null };
  const known = RDAP[domain];
  if (!known) throw new Error(`no fake RDAP answer for ${domain}`);
  const registeredAt = new Date(NOW.getTime() - known.registeredDaysAgo * DAY_MS).toISOString();
  const rdap: RdapLookupResult = { registeredAt };
  return { rdap, mx: [`mx.${domain}`] };
}

/** A profile entry as the confirmed intake writes it (source scan). */
const entry = (key: string, value: unknown): ProfileEntry =>
  ProfileEntrySchema.parse({
    key,
    label: key,
    value,
    confidence: null,
    evidence: [],
    source: "scan",
    updatedAt: NOW.toISOString(),
    updatedBy: null,
  });

interface Persona {
  name: string;
  expected: ExpectedFile;
  profile: { entries: ProfileEntry[] };
  cvs: CvCandidate[];
  matchAi: Record<string, MatchAiOutput>;
  drafts: Record<string, unknown>;
  mail: JobMessage[];
}

/** The CVs each persona marks preferred in MVP 2 S1, by name. */
const USER_PREFERRED: Record<string, string[]> = {
  maria: ["Backend (EN)"],
};

function loadPersona(name: string): Persona {
  const dir = `${FIXTURES}${name}/`;
  const expected = readJson<ExpectedFile>(`${dir}expected.json`);
  const answers = expected.profile.answers;
  const entries = Object.entries(answers).map(([key, { values }]) =>
    // MVP 1 S4: Maria removes Amsterdam from her places before confirming.
    entry(
      key,
      key === "places" && name === "maria"
        ? values.filter((p) => (p as { city: string | null }).city !== "Amsterdam")
        : values,
    ),
  );
  const cvRead = readJson<Record<string, unknown>>(`${FIXTURES}ai/${name}/cv.json`);
  const cvs = readJson<CvFile[]>(`${dir}cvs.json`).map((file, i): CvCandidate => {
    const read = CvReadOutputSchema.parse(cvRead[file.contentHash]);
    const kept = expected.cvs.find((c) => c.name === file.name);
    if (!kept) throw new Error(`${name}: no expected CV ${file.name}`);
    return {
      id: `cv-${i}`,
      name: file.name,
      language: read.language,
      // The skill check's outcome (cv/skills.ts, F2.2) is expected.json's.
      skills: kept.skills,
      roleFamilies: read.roleFamilies,
      seniority: read.seniority,
      tags: tagsAfterRead(read, []),
      preferred: USER_PREFERRED[name]?.includes(file.name) ?? false,
    };
  });
  const matchAi = Object.fromEntries(
    Object.entries(readJson<Record<string, unknown>>(`${FIXTURES}ai/${name}/match.json`)).map(
      ([k, v]) => [k, MatchAiOutputSchema.parse(v)],
    ),
  );
  const drafts = readJson<Record<string, unknown>>(`${FIXTURES}ai/${name}/draft.json`);

  const mail: JobMessage[] = [];
  for (const e of readJson<Envelope[]>(`${dir}envelopes.json`)) {
    const truth = expected.messages[e.messageId];
    if (!truth?.roles) continue;
    mail.push({
      persona: name,
      messageId: e.messageId,
      delivered: false,
      step: "backlog",
      from: e.from.address,
      subject: e.subject,
      text: plainText(readText(`${dir}mail/${e.file}`)),
      receivedAt: new Date(NOW.getTime() - e.minutesAgo * 60_000),
      truth,
    });
  }
  const deliveries = existsSync(`${dir}deliveries.json`)
    ? readJson<Delivery[]>(`${dir}deliveries.json`)
    : [];
  for (const d of deliveries) {
    const truth = expected.deliveries[d.messageId];
    if (!truth?.roles) throw new Error(`${name}: no ground truth for ${d.file}`);
    const raw = readText(`${dir}deliver/${d.file}`);
    mail.push({
      persona: name,
      messageId: d.messageId,
      delivered: true,
      step: d.step,
      from: fromAddress(raw),
      subject: decodeWords(header(raw, "Subject")),
      text: plainText(raw),
      receivedAt: new Date(NOW.getTime() - d.minutesAgo * 60_000),
      truth,
    });
  }
  return { name, expected, profile: { entries }, cvs, matchAi, drafts, mail };
}

/** What the engine makes of one role. */
interface RoleOutcome {
  cv: string | null;
  hardConflicts: string[];
  score: number;
  capped: boolean;
  fit: "good" | "below" | "capped";
  /** The reply plan before any draft: draft, ask (with the needs) or hold. */
  plan: ReturnType<typeof planReply>;
  /** The group keys the role waits on: the plan's, then its first draft's questions. */
  needs: string[];
  /** The plan's needs, as their decisions offer them. */
  asks: RoleNeed[];
}

type Profile = { entries: readonly ProfileEntry[] };

/** The reply threshold's default (F6.1): neither persona's profile sets reply_threshold. */
const THRESHOLD = 70;

function runMessage(persona: Persona, m: JobMessage, profile: Profile) {
  const category: Category | null = m.truth.category
    ? CategorySchema.parse(m.truth.category)
    : null;
  const facts: JobFacts[] = (m.truth.facts ?? []).map((f) => JobFactsSchema.parse(f));
  const language = detectLanguage(m.text);
  const companies = facts.flatMap((f) =>
    [f.company, f.agency?.name].filter((n): n is string => Boolean(n)),
  );
  const sender = checkSender({
    from: { address: m.from, name: null },
    category,
    companies,
    text: m.text,
    language,
    domain: domainFacts(m.from),
    mark: null,
    now: NOW,
  });
  const roles = facts.map((role, position): RoleOutcome => {
    const choice = chooseCv({ role, language, cvs: persona.cvs, override: null });
    const cvSkills = choice.cv?.skills ?? [];
    const taskInput = matchTaskInput({
      messageId: m.messageId,
      position,
      facts: role,
      profile,
      cvSkills,
    });
    const key = `${m.messageId}#${position}`;
    const ai = needsMatchAi(taskInput) ? (persona.matchAi[key] ?? null) : null;
    if (needsMatchAi(taskInput) && ai === null) throw new Error(`no match.v1 answer for ${key}`);
    const result = matchRole({
      facts: role,
      senderAddress: m.from,
      category,
      profile,
      rules: [],
      cv: { cvId: choice.cv?.id ?? null, skills: cvSkills },
      ai,
    });
    const { match, ruleEffects } = result;
    const needs = roleNeeds({
      evaluation: { match, ruleEffects },
      recorded: [],
      profile,
      answeredHere: new Set(),
    });
    const plan = planReply({
      origin: "auto",
      category,
      receivedAt: m.receivedAt,
      now: NOW,
      profile,
      score: match.score,
      capped: match.capped,
      senderVerdict: sender.verdict,
      ruleEffects,
      needs,
      draftHistory: { hadDraft: false, dismissed: false },
    });
    // What the first draft asks once the plan lets it be written (draft.v1, attempt 1).
    const firstDraft = persona.drafts[`${m.messageId}#${position}#1`];
    const asked =
      plan.kind !== "hold" && firstDraft
        ? needsFromQuestions(DraftOutputSchema.parse(firstDraft).questions)
        : [];
    return {
      cv: choice.cv?.name ?? null,
      hardConflicts: [
        ...new Set(
          match.verdicts
            .filter((v) => v.hard && v.verdict === "conflicts" && v.entryKey !== null)
            .map((v) => v.entryKey as string),
        ),
      ].sort(),
      score: match.score,
      capped: match.capped,
      fit: match.capped ? "capped" : match.score >= THRESHOLD ? "good" : "below",
      plan,
      needs: [...(plan.kind === "ask" ? plan.needs : []), ...asked].map((n) => n.groupKey),
      asks: plan.kind === "ask" ? plan.needs : [],
    };
  });
  return { sender, roles };
}

/** The decisions S5 answers with "Use this answer for similar mail", by persona and group key. */
const S5_ANSWERS: Record<string, string[]> = { maria: ["min_pay:CHF:year"] };

/** The profile after answering `groupKeys` with the first answer their decision suggests. */
function answered(profile: Profile, asks: readonly RoleNeed[], groupKeys: readonly string[]) {
  let entries = [...profile.entries];
  for (const groupKey of groupKeys) {
    const need = asks.find((n) => n.groupKey === groupKey);
    const suggested = need?.choices[0];
    if (!need?.profileKey || !suggested) throw new Error(`${groupKey}: never asked`);
    const answer = answerOf(need, suggested.value);
    if (answer?.kind !== "item") throw new Error(`${groupKey}: the suggested answer adds nothing`);
    const applied = applyChanges(
      { entries, rules: [] },
      [answerChange(need.profileKey, answer.item)],
      {
        profileId: "profile",
        source: "decision",
        userId: null,
        at: NOW.toISOString(),
        newRuleId: () => "00000000-0000-4000-8000-000000000001",
      },
    );
    if (!applied.ok) throw new Error(`${groupKey}: the answer doesn't apply`);
    entries = [...applied.entries];
  }
  return { entries };
}

const personas = PERSONAS.map(loadPersona);

describe("the engine against the personas' ground truth (e2e/fixtures)", () => {
  it("reads every persona's job mail, the backlog's and the delivered", () => {
    expect(PERSONAS).toEqual(["maria", "tom"]);
    const [maria, tom] = personas;
    expect(maria?.mail.filter((m) => !m.delivered).length).toBeGreaterThan(200);
    expect(maria?.mail.filter((m) => m.delivered)).toHaveLength(
      Object.keys(maria?.expected.deliveries ?? {}).length,
    );
    expect(tom?.mail.length).toBeGreaterThan(0);
  });

  it("chooses Backend (EN) for the delivered scam by the preferred mark Maria gives it in S1", () => {
    // "Remote Data Entry Assistant" shares one word with the data engineering CV's role family,
    // which counts as one skill; English is both CVs' language. Only the preferred mark on
    // Backend (EN) tells them apart, as expected.json says: without it, the data CV wins.
    const maria = personas.find((p) => p.name === "maria");
    const scam = maria?.mail.find((m) => m.messageId.startsWith("<maria-deliver-scam@"));
    if (!maria || !scam) throw new Error("no delivered scam");
    const role = JobFactsSchema.parse(scam.truth.facts?.[0]);
    const language = detectLanguage(scam.text);
    const choose = (cvs: CvCandidate[]) =>
      chooseCv({ role, language, cvs, override: null }).cv?.name;
    expect(choose(maria.cvs)).toBe("Backend (EN)");
    const unmarked = maria.cvs.map((cv) => ({ ...cv, preferred: false }));
    expect(choose(unmarked)).toBe("Data engineering (EN)");
  });

  for (const persona of personas) {
    describe(persona.name, () => {
      // The backlog and S2's mail meet the profile MVP 2 starts with; S5's second Zurich role
      // meets it after S5 answers the CHF minimum with a suggested amount, for similar mail.
      const before = persona.mail
        .filter((m) => m.step !== "S5")
        .map((m) => ({ m, ...runMessage(persona, m, persona.profile) }));
      const afterS5 = answered(
        persona.profile,
        before.flatMap(({ roles }) => roles.flatMap((r) => r.asks)),
        S5_ANSWERS[persona.name] ?? [],
      );
      const later = persona.mail
        .filter((m) => m.step === "S5")
        .map((m) => ({ m, ...runMessage(persona, m, afterS5) }));
      const runs = [...before, ...later];

      it("gives every sender the expected verdict (F5.1, F5.5)", () => {
        const got = runs.map(({ m, sender }) => [m.messageId, sender.verdict]);
        const want = runs.map(({ m }) => [m.messageId, m.truth.sender?.verdict]);
        expect(got).toEqual(want);
      });

      it("puts each message inside or outside the reply window as expected (F1.6)", () => {
        for (const { m } of runs) {
          const inside = withinReplyWindow(m.receivedAt, NOW, persona.profile);
          expect(!inside, m.messageId).toBe(m.truth.outsideReplyWindow ?? false);
        }
      });

      it("chooses the expected CV for every role (F2.3)", () => {
        const got = runs.flatMap(({ m, roles }) =>
          roles.map((r, i) => `${m.messageId}#${i} ${r.cv}`),
        );
        const want = runs.flatMap(({ m }) =>
          (m.truth.roles ?? []).map((r, i) => `${m.messageId}#${i} ${r.cv}`),
        );
        expect(got).toEqual(want);
      });

      it("finds the expected hard conflicts for every role (F4.2)", () => {
        const got = runs.flatMap(({ m, roles }) =>
          roles.map((r, i) => `${m.messageId}#${i} ${r.hardConflicts.join(",")}`),
        );
        const want = runs.flatMap(({ m }) =>
          (m.truth.roles ?? []).map(
            (r, i) => `${m.messageId}#${i} ${[...r.hardConflicts].sort().join(",")}`,
          ),
        );
        expect(got).toEqual(want);
      });

      it("lands every delivered role's fit score where expected (F4.1, F4.2)", () => {
        const delivered = runs.filter(({ m }) => m.delivered);
        const got = delivered.flatMap(({ m, roles }) =>
          roles.map((r, i) => `${m.messageId}#${i} ${r.fit}`),
        );
        const want = delivered.flatMap(({ m }) =>
          (m.truth.roles ?? []).map((r, i) => `${m.messageId}#${i} ${r.fit}`),
        );
        expect(got).toEqual(want);
      });

      it("asks exactly the expected decisions before a delivered role's draft (F7.1)", () => {
        const delivered = runs.filter(({ m }) => m.delivered);
        const got = delivered.flatMap(({ m, roles }) =>
          roles.map((r, i) => `${m.messageId}#${i} ${r.needs.join(",")}`),
        );
        const want = delivered.flatMap(({ m }) =>
          (m.truth.roles ?? []).map((r, i) => `${m.messageId}#${i} ${(r.needs ?? []).join(",")}`),
        );
        expect(got).toEqual(want);
      });

      it("plans a reply exactly for the roles that end up with a draft or wait on a decision (F6.1)", () => {
        // A role that waits on a decision is let through by the policy; whether it ends up with a
        // draft is the scenario's answer (Dublin's relocation question is declined in S5).
        const got = runs.flatMap(({ m, roles }) =>
          roles.map((r, i) => `${m.messageId}#${i} ${r.plan.kind !== "hold"}`),
        );
        const want = runs.flatMap(({ m }) =>
          (m.truth.roles ?? []).map(
            (r, i) => `${m.messageId}#${i} ${r.draft || (r.needs ?? []).length > 0}`,
          ),
        );
        expect(got).toEqual(want);
      });

      it("rejects only the fake AI's draft that holds a placeholder (F6.2)", () => {
        const byId = new Map(persona.mail.map((m) => [m.messageId, m]));
        const rejected: string[] = [];
        for (const [key, answer] of Object.entries(persona.drafts)) {
          const messageId = key.slice(0, key.indexOf(">#") + 1);
          const original = byId.get(messageId);
          if (!original) throw new Error(`a draft.v1 answer for unknown mail: ${key}`);
          const out = DraftOutputSchema.parse(answer);
          const found = findPlaceholders(`${out.subject}\n${out.body}`, {
            subject: original.subject,
            text: original.text,
          });
          if (found.length > 0) rejected.push(key);
        }
        // S4: the remote-EU role's first attempt has one; its second, and every other, has none.
        expect(rejected).toEqual(
          Object.keys(persona.drafts).filter((k) => k.includes("-remote-eu@") && k.endsWith("#1")),
        );
      });
    });
  }
});
