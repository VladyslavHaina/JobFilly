import {
  type AnswerFile,
  type ClassifyAnswer,
  type DeliveryEntry,
  type EnvelopeEntry,
  type ExpectedMessageAll,
  type ExtractAnswer,
  FIXTURE_REFERENCE_TIME,
  FOLDER_PATHS,
  isJobCategory,
  type MatchAnswer,
  matchKey,
  PERSONA_ADDRESSES,
  PERSONA_NAMES,
  type PrefsAnswer,
  personaPaths,
  personaPathsMvp2,
  REPLY_WINDOW_MINUTES,
  toJson,
} from "../format.ts";
import {
  type ExpectedMvp3,
  MARIA_HOME_ADDRESS,
  MARIA_PROFILES,
  MARIA_RERUN_HINT,
  MVP3_DIRS,
  MVP3_PATHS,
} from "../format-mvp3.ts";
import { buildFixtures, composeText, type FileContent, generatedFilesOnDisk } from "./build.ts";
import { checkedSkills, cvNamed } from "./cvs.ts";
import { DELIVERIES, deliveredMessageId, deliverySpec } from "./deliveries.ts";
import { buildEml, toHtml } from "./eml.ts";
import { GERMANY_REPLIES } from "./germany.ts";
import { backendTitleFit, matchAnswer, type PersonaJudge } from "./judge.ts";
import { mariaHome } from "./maria-home.ts";
import { RERUN_FOCUS } from "./mvp3.ts";
import { MANUAL_STAGE, PIPELINE_ITEMS } from "./pipeline.ts";
import { questions } from "./questions.ts";
import type { Lang } from "./recruiters.ts";
import type { MessageSpec } from "./spec.ts";

// The MVP 3 fixture files (format-mvp3.ts) on top of buildFixtures' (build.ts): the replies S1
// appends to Sent, Maria's second mailbox, the assistant's questions and expected.json's `mvp3`.
// MVP 3's Inbox deliveries (germany.ts, pipeline.ts) are deliveries like MVP 2's, so build.ts
// writes them with their classify, extract, match and draft answers. Here the new messages'
// answers are added to Maria's answer files and nothing buildFixtures writes is changed:
// build.test.ts checks that every key it wrote keeps its value.

const ME = { address: PERSONA_ADDRESSES.maria, name: PERSONA_NAMES.maria };

/** The .eml text of a message, dated FIXTURE_REFERENCE_TIME minus minutesAgo. */
function emlOf(m: MessageSpec, sentinel: string, boundary: string): { eml: string; text: string } {
  const text = composeText(m, sentinel);
  const date = new Date(Date.parse(FIXTURE_REFERENCE_TIME) - m.minutesAgo * 60_000);
  return { eml: buildEml({ ...m, date, text, html: toHtml(text), boundary }), text };
}

const quote = (text: string) =>
  text
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

/** Maria's judge (build.ts sources()): the CV for a role, and backend titles fit. */
const MARIA_JUDGE: PersonaJudge = {
  persona: "maria",
  cvFor: (role, language: Lang) => {
    const cv = cvNamed(
      /data engineer/i.test(role.title ?? "")
        ? "Data engineering (EN)"
        : language === "de"
          ? "Backend (DE)"
          : "Backend (EN)",
    );
    return { name: cv.name, skills: checkedSkills(cv) };
  },
  titleFit: backendTitleFit,
};

/** One of S1's replies as a Sent message answering its delivery. */
function sentReplySpec(r: (typeof GERMANY_REPLIES)[number]): MessageSpec {
  const original = DELIVERIES.find((d) => d.id === r.inReplyTo);
  if (!original) throw new Error(`${r.id} answers no delivery`);
  const parent = deliverySpec(original);
  return {
    messageId: `<maria-deliver-${r.id}@${ME.address.slice(ME.address.indexOf("@") + 1)}>`,
    folder: "sent",
    minutesAgo: r.minutesAgo,
    from: ME,
    to: [original.from],
    cc: [],
    replyTo: [],
    subject: `Re: ${original.subject}`,
    body: `${r.text}\n\n${original.from.name ?? original.from.address} wrote:\n${quote(original.body)}`,
    footer: original.footer.map(quote),
    inReplyTo: parent.messageId,
    references: [...parent.references, parent.messageId],
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    language: original.language,
    stageOne: "own_reply",
    category: "other_job",
    facts: [],
    preferences: r.preferences,
    invalid: false,
    hardConflicts: null,
  };
}

/** The ground truth of a message the app reads but MVP 2's lists don't hold. */
function truthOf(m: MessageSpec): ExpectedMessageAll {
  const ownReply = m.stageOne === "own_reply";
  const truth: ExpectedMessageAll = {
    folder: m.folder,
    stageOne: m.stageOne,
    category: m.category,
    facts: m.facts,
    ownReply,
    invalid: false,
  };
  if (!isJobCategory(m.category) || ownReply) return truth;
  return {
    ...truth,
    sender: { verdict: "looks_fine" },
    outsideReplyWindow: m.minutesAgo >= REPLY_WINDOW_MINUTES,
    roles: (m.facts ?? []).map((facts, i) => {
      const conflicts = m.hardConflicts?.[i];
      if (conflicts === undefined) throw new Error(`no hard conflicts for ${m.messageId} #${i}`);
      return {
        cv: MARIA_JUDGE.cvFor(facts, m.language).name,
        hardConflicts: [...conflicts],
        draft: false,
      };
    }),
  };
}

const snippetOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);

function envelopeOf(m: MessageSpec, file: string, text: string): EnvelopeEntry {
  return {
    file,
    messageId: m.messageId,
    folder: m.folder,
    folderPath: FOLDER_PATHS[m.folder],
    minutesAgo: m.minutesAgo,
    from: m.from,
    to: m.to,
    cc: m.cc,
    replyTo: m.replyTo,
    inReplyTo: m.inReplyTo,
    references: m.references,
    subject: m.subject,
    listId: m.listId,
    listUnsubscribe: m.listUnsubscribe,
    precedence: m.precedence,
    autoSubmitted: null,
    snippet: snippetOf(text),
  };
}

/** Adds entries to a JSON map buildFixtures wrote, refusing to change a key it has. */
function addEntries(files: Map<string, FileContent>, path: string, entries: object): void {
  const current = files.get(path);
  if (typeof current !== "string") throw new Error(`${path} is not a generated JSON file`);
  const map = JSON.parse(current) as Record<string, unknown>;
  for (const [key, value] of Object.entries(entries)) {
    if (key in map) throw new Error(`${path} already has ${key}`);
    map[key] = value;
  }
  files.set(path, toJson(map));
}

/** The `mvp3` part of Maria's expected.json, from the sources. */
function expectedMvp3(sent: MessageSpec[], home: MessageSpec[]): ExpectedMvp3 {
  const assignments: ExpectedMvp3["assignments"] = {};
  for (const d of DELIVERIES) {
    d.roles.forEach((r, i) => {
      if (r.profile) assignments[matchKey(deliveredMessageId(d.id), i)] = r.profile;
    });
  }
  const byId = new Map(DELIVERIES.map((d) => [d.id, d]));
  return {
    profiles: MARIA_PROFILES,
    assignments,
    rerun: {
      hint: MARIA_RERUN_HINT,
      focus: RERUN_FOCUS,
      // Her moved replies, newest first: places, contracts and pay as the newest states them.
      proposes: {
        places: [
          { country: "DE", city: "München", mode: "hybrid" },
          { country: "DE", city: "Hamburg", mode: "hybrid" },
        ],
        contracts: ["unbefristet", "permanent"],
        min_pay: [
          { amount: 75000, currency: "EUR", period: "year", asWritten: "75.000 € brutto im Jahr" },
        ],
      },
      evidence: [...sent].sort((a, b) => a.minutesAgo - b.minutesAgo).map((m) => m.messageId),
    },
    pipeline: PIPELINE_ITEMS.map((item) => ({
      id: item.id,
      deliveries: item.deliveries,
      roles: item.deliveries.map((id) => matchKey(deliveredMessageId(id), 0)),
      title: item.title,
      company: item.company,
      stage: item.stage,
      flagged: item.flagged,
      senders: [...new Set(item.deliveries.map((id) => byId.get(id)?.from.address as string))],
    })),
    manualStage: { ...MANUAL_STAGE },
    sent: Object.fromEntries(sent.map((m) => [m.messageId, truthOf(m)])),
    home: {
      address: MARIA_HOME_ADDRESS,
      messages: Object.fromEntries(home.map((m) => [m.messageId, truthOf(m)])),
    },
  };
}

/** Every generated fixture file: buildFixtures' and MVP 3's, by path relative to e2e/fixtures. */
export function buildAllFixtures(): Map<string, FileContent> {
  const files = buildFixtures();
  const paths = personaPaths("maria");
  const classify: AnswerFile<ClassifyAnswer> = {};
  const extract: AnswerFile<ExtractAnswer> = {};
  const prefs: AnswerFile<PrefsAnswer> = {};
  const match: Record<string, MatchAnswer> = {};

  // S1's replies, appended to Sent by `seed deliver S1`.
  const sent = GERMANY_REPLIES.map(sentReplySpec);
  const sentEntries: DeliveryEntry[] = GERMANY_REPLIES.map((r, i) => {
    const m = sent[i] as MessageSpec;
    const { eml } = emlOf(m, `BODYSENTINEL-maria-deliver-sent-${r.id}`, `=_jf_maria_sent_${r.id}`);
    files.set(`${MVP3_PATHS.sentDeliver}/${r.id}.eml`, eml);
    classify[m.messageId] = { category: m.category };
    prefs[m.messageId] = { preferences: m.preferences ?? {} };
    return {
      id: r.id,
      file: `${r.id}.eml`,
      messageId: m.messageId,
      minutesAgo: r.minutesAgo,
      step: r.step,
    };
  });
  files.set(MVP3_PATHS.sentDeliveries, toJson(sentEntries));

  // The personal mailbox, numbered newest first like a persona's.
  const home = [...mariaHome()].sort((a, b) => a.minutesAgo - b.minutesAgo);
  const envelopes = home.map((m, i) => {
    const name = String(i + 1).padStart(4, "0");
    const { eml, text } = emlOf(
      m,
      `BODYSENTINEL-maria-home-inbox-${name}`,
      `=_jf_maria-home_${name}`,
    );
    files.set(`${MVP3_PATHS.homeMail}/inbox/${name}.eml`, eml);
    classify[m.messageId] = { category: m.category };
    if (isJobCategory(m.category)) {
      extract[m.messageId] = { roles: m.facts ?? [] };
      (m.facts ?? []).forEach((facts, position) => {
        const cv = MARIA_JUDGE.cvFor(facts, m.language);
        match[matchKey(m.messageId, position)] = matchAnswer(MARIA_JUDGE, facts, cv);
      });
    }
    return envelopeOf(m, `inbox/${name}.eml`, text);
  });
  files.set(MVP3_PATHS.homeEnvelopes, toJson(envelopes));

  addEntries(files, paths.classify, classify);
  addEntries(files, paths.extract, extract);
  addEntries(files, paths.prefs, prefs);
  addEntries(files, personaPathsMvp2("maria").match, match);
  addEntries(files, paths.expected, { mvp3: expectedMvp3(sent, home) });
  files.set(MVP3_PATHS.questions, toJson(questions()));
  return files;
}

/** Every file now in the generated directories under `root` (e2e/fixtures), MVP 3's included. */
export function generatedFixturesOnDisk(root: string): string[] {
  return [...generatedFilesOnDisk(root), ...generatedFilesOnDisk(root, MVP3_DIRS)];
}
