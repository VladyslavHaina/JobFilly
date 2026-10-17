import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DomainsFile } from "../rdap/domains.ts";
import {
  ANSWER_ANSWERS_PATH,
  type AnswerAnswerFile,
  ASSISTANT_ANSWERS_PATH,
  ASSISTANT_ANY_TURN,
  type AssistantAnswerFile,
  assistantMessageKey,
  assistantRoundKey,
  type ClassifyAnswer,
  type DeliveryEntry,
  type DraftAnswer,
  draftKey,
  type EnvelopeEntry,
  type ExpectedMessageAll,
  type ExtractAnswer,
  FIXTURE_REFERENCE_TIME,
  FOCUS_ANSWERS_PATH,
  FOLLOW_UP_TOOLS,
  type FocusAnswerFile,
  fixturesDir,
  isJobCategory,
  MARIA_KEY_MESSAGES,
  type MatchAnswer,
  matchKey,
  PERSONA_ADDRESSES,
  PERSONAS,
  type PrefsAnswer,
  personaPaths,
  personaPathsMvp2,
  REPLY_WINDOW_MINUTES,
  readJson,
} from "./format.ts";
import {
  type AssistantQuestion,
  type ExpectedFileMvp3,
  type ExpectedMvp3,
  type Lookup,
  MARIA_HOME_ADDRESS,
  MARIA_PROFILES,
  MARIA_RERUN_HINT,
  MVP3_PATHS,
} from "./format-mvp3.ts";
import { type ParsedEml, parseAddresses, parseEml } from "./read-eml.ts";
import { soakAnswers, soakMessage, soakMessageId } from "./soak.ts";

// MVP 3's fixtures against what its scenarios need, from the files
// alone, like consistency.test.ts: S1's Germany batch and the replies it delivers to Sent, S6's
// pipeline threads, Maria's second mailbox (S4, S12), the assistant's questions (S7, S9) and the
// fake AI's answers for all of them.

const root = fixturesDir();
const read = <T>(path: string): T => readJson<T>(join(root, path));
const eml = (path: string): ParsedEml => parseEml(readFileSync(join(root, path), "utf8"));
const DAY = 24 * 60;
/** A template placeholder (consistency.test.ts): "[Name]", "{company}". */
const PLACEHOLDER = /\[[^\]\n]+\]|\{[^}\n]+\}/;

const expected = read<ExpectedFileMvp3>(personaPaths("maria").expected);
const mvp3 = expected.mvp3 as ExpectedMvp3;
const deliveries = read<DeliveryEntry[]>(personaPathsMvp2("maria").deliveries);
const sentDeliveries = read<DeliveryEntry[]>(MVP3_PATHS.sentDeliveries);
const homeEnvelopes = read<EnvelopeEntry[]>(MVP3_PATHS.homeEnvelopes);
const classify = read<Record<string, ClassifyAnswer>>(personaPaths("maria").classify);
const extract = read<Record<string, ExtractAnswer>>(personaPaths("maria").extract);
const prefs = read<Record<string, PrefsAnswer>>(personaPaths("maria").prefs);
const match = read<Record<string, MatchAnswer>>(personaPathsMvp2("maria").match);
const draft = read<Record<string, DraftAnswer>>(personaPathsMvp2("maria").draft);

const delivery = (id: string) => {
  const entry = deliveries.find((d) => d.id === id);
  if (!entry) throw new Error(`no delivery ${id}`);
  const truth = expected.deliveries[entry.messageId] as ExpectedMessageAll;
  return { entry, truth, eml: eml(`${personaPathsMvp2("maria").deliver}/${entry.file}`) };
};
const ofStep = (step: string) => deliveries.filter((d) => d.step === step).map((d) => d.id);

describe("S1's Germany batch", () => {
  const ids = ofStep("S1");
  const roles = ids.flatMap((id) => {
    const d = delivery(id);
    return (d.truth.facts ?? []).map((facts, i) => ({ ...d, facts, i }));
  });
  const german = roles.filter((r) => r.facts.places.some((p) => p.country === "DE"));
  const remote = roles.filter((r) => r.facts.workMode === "remote");

  it("brings hybrid roles in München and Hamburg, in German, paid yearly in EUR, permanent", () => {
    expect([...new Set(german.flatMap((r) => r.facts.places.map((p) => p.city)))].sort()).toEqual([
      "Hamburg",
      "München",
    ]);
    for (const r of german) {
      expect(r.facts.workMode, r.entry.id).toBe("hybrid");
      expect(r.facts.pay, r.entry.id).toMatchObject({ currency: "EUR", period: "year" });
      expect(r.facts.contract, r.entry.id).toBe("unbefristet");
      expect(r.eml.text, r.entry.id).toMatch(/brutto pro Jahr/);
      expect(r.eml.text, r.entry.id).toMatch(/unbefristet/);
    }
    expect(german.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps her remote EU mail coming, in English", () => {
    expect(remote.length).toBeGreaterThanOrEqual(1);
    for (const r of remote) {
      expect(r.facts.remoteScope, r.entry.id).toBe("within the EU");
      expect(r.eml.text, r.entry.id).toMatch(/remote/);
      expect(r.truth.roles?.[r.i], r.entry.id).toMatchObject({ fit: "good", draft: true });
    }
  });

  it("sends München and Hamburg to the new profile and the remote roles to the first (F1.4)", () => {
    const want = Object.fromEntries(
      roles.map((r) => [
        matchKey(r.entry.messageId, r.i),
        r.facts.workMode === "remote" ? MARIA_PROFILES.first : MARIA_PROFILES.germany,
      ]),
    );
    expect(mvp3.assignments).toEqual(want);
  });

  it("gives every role draft answers in its mail's language, for both attempts", () => {
    for (const r of roles) {
      const language = r.facts.places.some((p) => p.country === "DE") ? "de" : "en";
      for (const attempt of [1, 2] as const) {
        const a = draft[draftKey(r.entry.messageId, r.i, attempt)];
        expect(a, `${r.entry.id} #${attempt}`).toBeDefined();
        expect(a?.language, r.entry.id).toBe(language);
        expect(a?.questions, r.entry.id).toEqual([]);
      }
    }
  });

  it("is dated within the last two days, inside the reply window", () => {
    for (const id of ids) {
      expect(delivery(id).entry.minutesAgo, id).toBeLessThan(2 * DAY);
      expect(delivery(id).truth.outsideReplyWindow, id).toBe(false);
    }
  });
});

describe("S1's replies, delivered to Sent", () => {
  const replies = sentDeliveries.map((entry) => ({
    entry,
    eml: eml(`${MVP3_PATHS.sentDeliver}/${entry.file}`),
    truth: mvp3.sent[entry.messageId] as ExpectedMessageAll,
  }));

  it("are one .eml each, delivered in S1, with sentinels like every message's", () => {
    expect(readdirSync(join(root, MVP3_PATHS.sentDeliver)).sort()).toEqual(
      sentDeliveries.map((e) => e.file).sort(),
    );
    expect(Object.keys(mvp3.sent).sort()).toEqual(sentDeliveries.map((e) => e.messageId).sort());
    const reference = Date.parse(FIXTURE_REFERENCE_TIME);
    for (const { entry, eml: m } of replies) {
      expect(entry.step).toBe("S1");
      expect(m.headers.get("message-id")).toBe(entry.messageId);
      expect(Date.parse(m.headers.get("date") as string)).toBe(
        reference - entry.minutesAgo * 60_000,
      );
      const sentinel = `BODYSENTINEL-maria-deliver-sent-${entry.id}`;
      for (const body of [m.text, m.html]) {
        expect(body.indexOf(sentinel)).toBeGreaterThanOrEqual(1000);
        expect(body.split("BODYSENTINEL-")).toHaveLength(2);
      }
    }
  });

  it("are Maria's own replies to S1's mail, after it, saying she has moved", () => {
    const s1 = new Map(ofStep("S1").map((id) => [delivery(id).entry.messageId, delivery(id)]));
    for (const { entry, eml: m, truth } of replies) {
      expect(parseAddresses(m.headers.get("from"))[0]?.address).toBe(PERSONA_ADDRESSES.maria);
      const parent = s1.get(m.headers.get("in-reply-to") as string);
      expect(parent, entry.id).toBeDefined();
      expect(m.headers.get("references")).toBe(parent?.entry.messageId);
      expect(entry.minutesAgo).toBeLessThan(parent?.entry.minutesAgo as number);
      expect(m.text).toMatch(/moved to Germany|nach Deutschland gezogen/);
      expect(truth).toEqual({
        folder: "sent",
        stageOne: "own_reply",
        category: "other_job",
        facts: [],
        ownReply: true,
        invalid: false,
      });
      expect(classify[entry.messageId]).toEqual({ category: "other_job" });
    }
  });

  it("state what the re-run proposes, and only they are its evidence", () => {
    const stated = replies.map((r) => prefs[r.entry.messageId]?.preferences ?? {});
    for (const [key, values] of Object.entries(mvp3.rerun.proposes)) {
      for (const value of values as unknown[]) {
        const found = stated.some((p) =>
          ((p as Record<string, unknown[]>)[key] ?? []).some(
            (v) => JSON.stringify(v) === JSON.stringify(value),
          ),
        );
        expect(found, `${key}: ${JSON.stringify(value)}`).toBe(true);
      }
    }
    expect(mvp3.rerun.proposes.places?.every((p) => p.country === "DE")).toBe(true);
    expect(mvp3.rerun.proposes.contracts).toContain("permanent");
    expect(mvp3.rerun.proposes.min_pay?.[0]).toMatchObject({ currency: "EUR", period: "year" });
    expect([...mvp3.rerun.evidence].sort()).toEqual(replies.map((r) => r.entry.messageId).sort());
  });

  it("give focus.v1 an answer for S1's hint: Germany, permanent", () => {
    const focus = read<FocusAnswerFile>(FOCUS_ANSWERS_PATH);
    expect(mvp3.rerun.hint).toBe(MARIA_RERUN_HINT);
    expect(focus[assistantMessageKey(MARIA_RERUN_HINT)]).toEqual(mvp3.rerun.focus);
    expect(mvp3.rerun.focus).toMatchObject({ countries: ["DE"], contracts: ["permanent"] });
  });
});

describe("S6's pipeline threads", () => {
  const items = new Map(mvp3.pipeline.map((p) => [p.id, p]));
  const thread = (id: string) => (items.get(id)?.deliveries ?? []).map(delivery);

  it("are delivered in S6, every item's roles named by its deliveries", () => {
    const all = mvp3.pipeline.flatMap((p) => p.deliveries);
    expect(all.sort()).toEqual(ofStep("S6").sort());
    for (const p of mvp3.pipeline) {
      expect(p.roles).toEqual(p.deliveries.map((id) => matchKey(delivery(id).entry.messageId, 0)));
      for (const d of p.deliveries.map(delivery)) {
        expect(d.truth.facts?.[0], d.entry.id).toMatchObject({
          title: p.title,
          company: p.company,
        });
        expect(d.truth.roles?.[0]?.draft, d.entry.id).toBe(false);
      }
    }
    expect([...items.keys()]).toEqual(["offer", "rejection", "silent", "two-agencies"]);
  });

  it("thread each answer to the mail before it with In-Reply-To and References", () => {
    for (const id of ["offer", "rejection"]) {
      const mail = thread(id);
      mail.forEach((d, i) => {
        const before = mail.slice(0, i).map((x) => x.entry.messageId);
        expect(d.eml.headers.get("in-reply-to") ?? null, d.entry.id).toBe(before.at(-1) ?? null);
        expect(d.eml.headers.get("references")?.split(/\s+/) ?? [], d.entry.id).toEqual(before);
        if (i > 0) expect(d.entry.minutesAgo).toBeLessThan(mail[i - 1]?.entry.minutesAgo as number);
      });
    }
  });

  it("go confirmation → interview → offer, and confirmation → rejection", () => {
    expect(thread("offer").map((d) => d.truth.category)).toEqual([
      "application_update",
      "interview",
      "offer",
    ]);
    expect(thread("rejection").map((d) => d.truth.category)).toEqual([
      "application_update",
      "rejection",
    ]);
    expect(items.get("offer")).toMatchObject({ stage: "offer", flagged: false });
    expect(items.get("rejection")).toMatchObject({ stage: "rejected", flagged: false });
  });

  it("leave one application unanswered for 25 days, past the 21-day flag", () => {
    const [silent, ...rest] = thread("silent");
    expect(rest).toEqual([]);
    expect(silent?.truth.category).toBe("application_update");
    expect(silent?.entry.minutesAgo).toBe(25 * DAY);
    expect(items.get("silent")).toMatchObject({ stage: "applied", flagged: true });
    expect(mvp3.manualStage).toEqual({ item: "silent", stage: "interview" });
    // Nothing else S6 delivers waits 21 days: each other item's newest mail is younger.
    for (const id of ["offer", "rejection", "two-agencies"]) {
      expect(Math.min(...thread(id).map((d) => d.entry.minutesAgo)), id).toBeLessThan(21 * DAY);
    }
  });

  it("send one role from two agencies: same title and client, two senders", () => {
    const [a, b] = thread("two-agencies");
    for (const d of [a, b]) expect(d?.truth.category).toBe("recruiter_outreach");
    const fa = a?.truth.facts?.[0];
    const fb = b?.truth.facts?.[0];
    expect(fa?.title).toBe(fb?.title);
    expect(fa?.agency?.client).toBe(fb?.agency?.client);
    expect(fa?.company).toBe(fa?.agency?.client);
    expect(fa?.agency?.name).not.toBe(fb?.agency?.name);
    expect(items.get("two-agencies")?.senders).toEqual(
      [a, b].map((d) => parseAddresses(d?.eml.headers.get("from"))[0]?.address),
    );
    expect(items.get("two-agencies")).toMatchObject({ stage: "new", flagged: false });
  });
});

describe("Maria's second mailbox", () => {
  const dir = MVP3_PATHS.homeMail;
  const mail = homeEnvelopes.map((e) => ({ e, eml: eml(`${dir}/${e.file}`) }));
  const truth = mvp3.home.messages;
  const job = mail.filter(({ e }) => isJobCategory(truth[e.messageId]?.category ?? "not_job"));

  it("is her personal address, a few job emails and a friend's mail", () => {
    expect(mvp3.home.address).toBe(MARIA_HOME_ADDRESS);
    expect(readdirSync(join(root, dir, "inbox")).sort()).toEqual(
      homeEnvelopes.map((e) => e.file.replace("inbox/", "")).sort(),
    );
    expect(Object.keys(truth).sort()).toEqual(homeEnvelopes.map((e) => e.messageId).sort());
    expect(job.length).toBeGreaterThanOrEqual(3);
    expect(mail.length).toBeGreaterThan(job.length);
    for (const { e, eml: m } of mail) {
      expect(parseAddresses(m.headers.get("to"))).toEqual([
        { address: MARIA_HOME_ADDRESS, name: "Maria Santos" },
      ]);
      expect(m.headers.get("message-id")).toBe(e.messageId);
      expect(e.messageId).toMatch(/^<maria-home-\d{4}@/);
      expect(e.minutesAgo).toBeLessThan(REPLY_WINDOW_MINUTES);
      const sentinel = `BODYSENTINEL-maria-home-${e.file.replace(".eml", "").replace("/", "-")}`;
      for (const body of [m.text, m.html]) {
        expect(body.indexOf(sentinel), e.file).toBeGreaterThanOrEqual(1000);
        expect(body.split("BODYSENTINEL-")).toHaveLength(2);
      }
    }
  });

  it("answers every message in the fake AI, and no role gets a draft", () => {
    for (const { e } of mail) {
      const t = truth[e.messageId] as ExpectedMessageAll;
      expect(classify[e.messageId]).toEqual({ category: t.category });
      if (!isJobCategory(t.category)) continue;
      expect(extract[e.messageId]).toEqual({ roles: t.facts });
      expect(t.sender).toEqual({ verdict: "looks_fine" });
      (t.facts ?? []).forEach((_, i) => {
        expect(match[matchKey(e.messageId, i)], e.messageId).toBeDefined();
        expect(draft[draftKey(e.messageId, i, 1)]).toBeUndefined();
        expect(t.roles?.[i]?.draft).toBe(false);
      });
    }
  });

  it("caps the only recruiter outreach with a hard conflict, so it never gets a draft", () => {
    const outreach = job.filter(({ e }) => truth[e.messageId]?.category === "recruiter_outreach");
    expect(outreach.length).toBe(1);
    for (const { e } of outreach) {
      for (const r of truth[e.messageId]?.roles ?? [])
        expect(r.hardConflicts.length).toBeGreaterThan(0);
    }
  });

  it("comes only from sender domains the test stack's RDAP and DNS data know", () => {
    const known = read<DomainsFile>("../rdap/domains.json").domains;
    for (const { e } of mail) {
      const domain = e.from.address.slice(e.from.address.indexOf("@") + 1);
      expect(known[domain], domain).toBeDefined();
    }
  });
});

describe("the assistant's questions (MVP 3)", () => {
  const questions = read<AssistantQuestion[]>(MVP3_PATHS.questions);
  const assistant = read<AssistantAnswerFile>(ASSISTANT_ANSWERS_PATH);
  const answers = read<AnswerAnswerFile>(ANSWER_ANSWERS_PATH);
  const answerOf = (q: AssistantQuestion) =>
    answers[assistantMessageKey(q.text)]?.[ASSISTANT_ANY_TURN];
  const known = new Set([...Object.keys(expected.messages), ...Object.keys(expected.deliveries)]);

  it("are ten, in English, German and Portuguese", () => {
    expect(questions).toHaveLength(10);
    expect(new Set(questions.map((q) => q.id)).size).toBe(10);
    expect([...new Set(questions.map((q) => q.language))].sort()).toEqual(["de", "en", "pt"]);
  });

  it("hold S9's three questions and S7's, asked by Tom, that gets no body", () => {
    expect(questions.filter((q) => q.scenario === "S9").map((q) => q.text)).toEqual([
      "What's waiting on me?",
      "Why didn't the Singapore role get a draft?",
      "How many interviews did I have in the last 30 days?",
    ]);
    const s7 = questions.filter((q) => q.scenario === "S7");
    expect(s7).toHaveLength(1);
    expect(s7[0]).toMatchObject({ asker: "tom", expected: { withholdsBody: true } });
    expect(s7[0]?.lookups.map((l) => l.tool)).toContain("message_text");
    expect(questions.filter((q) => q.expected.ignoresMailInstructions)).toHaveLength(1);
  });

  it("get assistant.v1's lookups over two rounds and answer.v1's answer at any turn", () => {
    for (const q of questions) {
      const byTurn = assistant[assistantMessageKey(q.text)];
      const first = byTurn?.[ASSISTANT_ANY_TURN];
      const second = byTurn?.[assistantRoundKey(ASSISTANT_ANY_TURN, 2)];
      for (const round of [first, second]) {
        expect(round, q.id).toMatchObject({ clarify: null, proposal: null });
      }
      // Round 1 finds what round 2 reads by its Message-ID, as a model that knows none would.
      const later = (l: Lookup) => FOLLOW_UP_TOOLS.includes(l.tool);
      expect(first?.lookups, q.id).toEqual(q.lookups.filter((l) => !later(l)));
      expect(second?.lookups, q.id).toEqual(q.lookups.filter(later));
      expect(first?.lookups?.length, q.id).toBeGreaterThan(0);
      expect(answerOf(q), q.id).toBeDefined();
    }
  });

  it("link only messages, roles and decisions the fixtures hold, the expected links among them", () => {
    for (const q of questions) {
      const sources = answerOf(q)?.sources ?? [];
      for (const s of sources) {
        const id = s.kind === "role" || s.kind === "draft" ? s.ref.replace(/#\d+$/, "") : s.ref;
        if (s.kind === "decision") expect(s.ref, q.id).toMatch(/^[a-z_]+[:.]/);
        else expect(known.has(id), `${q.id}: ${s.ref}`).toBe(true);
      }
      for (const link of q.expected.links) {
        expect(sources, `${q.id}: ${link.ref}`).toContainEqual(link);
      }
      if (q.expected.withholdsBody) {
        expect(
          sources.filter((s) => s.kind === "message"),
          q.id,
        ).toEqual([]);
      }
    }
  });

  it("count S9's interviews: the roles in Interview that got there in the last 30 days", () => {
    const q = questions.find((x) => x.id === "interviews") as AssistantQuestion;
    expect(q.lookups).toEqual([
      {
        tool: "pipeline",
        words: null,
        messageId: null,
        position: null,
        stage: "interview",
        days: 30,
      },
    ]);
    // The backlog's interview invite, and the role S6 moves to Interview by hand; Lindwurm
    // Robotics' interview has moved on to its offer (S6's "offer" item).
    expect(q.expected.count).toBe(2);
    const interview = (id: string) => expected.deliveries[id] ?? expected.messages[id];
    const invites = q.expected.links
      .map((l) => l.ref.replace(/#\d+$/, ""))
      .filter((id) => interview(id)?.category === "interview");
    expect(invites).toEqual([MARIA_KEY_MESSAGES.interviewInvite]);
    const manual = mvp3.pipeline.find((p) => p.id === mvp3.manualStage.item);
    expect(q.expected.links.map((l) => l.ref)).toContain(manual?.roles[0]);
    expect(mvp3.pipeline.find((p) => p.id === "offer")?.stage).toBe("offer");
    expect(answerOf(q)?.text).toMatch(/^Two /);
  });

  it("answer without template placeholders", () => {
    for (const q of questions) expect(answerOf(q)?.text, q.id).not.toMatch(PLACEHOLDER);
  });
});

describe("the soak's generated mail (F10.3)", () => {
  const known = read<DomainsFile>("../rdap/domains.json").domains;

  it("is a recruiter's onsite role to each persona, from a sender domain the stack knows", () => {
    for (const persona of PERSONAS) {
      const id = soakMessageId(persona, "r1", 1);
      const m = parseEml(
        soakMessage(persona, "r1", 1, new Date(FIXTURE_REFERENCE_TIME)).toString(),
      );
      expect(m.headers.get("message-id")).toBe(id);
      expect(parseAddresses(m.headers.get("to"))[0]?.address).toBe(PERSONA_ADDRESSES[persona]);
      const from = parseAddresses(m.headers.get("from"))[0]?.address ?? "";
      expect(known[from.slice(from.indexOf("@") + 1)], from).toBeDefined();
      expect(m.text.indexOf(`BODYSENTINEL-soak-${persona}-r1-1`)).toBeGreaterThanOrEqual(1000);
      const answers = soakAnswers(id);
      expect(answers?.classify).toEqual({ category: "recruiter_outreach" });
      expect(answers?.extract.roles.map((r) => r.workMode)).toEqual(["onsite"]);
      expect(answers?.draft.body, persona).not.toMatch(PLACEHOLDER);
    }
  });
});
