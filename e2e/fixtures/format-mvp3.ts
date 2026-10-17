import type {
  AnswerAnswer,
  ExpectedFileMvp2,
  ExpectedMessageAll,
  FocusAnswer,
  Persona,
  ProfileValues,
} from "./format.ts";

// MVP 3's part of the fixture contract, next to format.ts's MVP 1 and
// MVP 2 parts. The generator (e2e/fixtures/build: mvp3-files.ts) writes these files, the seed and
// the fake AI read them, and the consistency tests check them.
//
// e2e/fixtures/
//   maria/deliver/<id>.eml          from MVP 2 on: S1's Germany batch and S6's pipeline threads
//                                   are deliveries like MVP 2's (deliveries.json, step S1 or S6)
//   maria/deliver-sent/<id>.eml     Maria's replies saying she has moved (S1), which
//   maria/deliveries-sent.json      `seed deliver` appends to her Sent folder (DeliveryEntry[])
//   maria-home/mail/inbox/<nnnn>.eml  Maria's second mailbox, her personal address (S4, S12):
//   maria-home/envelopes.json         loaded by `seed load maria-home`; no expected.json here,
//                                     its ground truth is in maria/expected.json (`mvp3.home`)
//   assistant/questions.json        AssistantQuestion[]: the ten questions of F8 (S7, S9 and the
//                                   real-AI quality run), each with its expected answer and links
//   maria/expected.json             gains `mvp3` (ExpectedMvp3): the profile every S1 role goes
//                                   to (F1.4), what the re-run proposes (S1), the pipeline (S6),
//                                   the replies delivered to Sent and the second mailbox's truth
// The fake AI's answers for every new message (classify, extract, prefs, match, draft) are in
// ai/maria/*.json with the rest of Maria's; focus.v1 in ai/focus.json, answer.v1 in
// ai/answer.json, assistant.v1's lookups in ai/assistant.json. Every key MVP 1 and MVP 2 wrote
// keeps its value: MVP 3 only adds.

/** Maria's personal mailbox (seed/accounts.ts EXTRA_ACCOUNTS), loaded like a persona's. */
export const MARIA_HOME = "maria-home";
export const MARIA_HOME_ADDRESS = "maria.home@post.example";

/**
 * Where a persona's mail for its Sent folder lives (`seed deliver` reads both files when they
 * exist; only Maria has them).
 */
export function sentDeliveryPaths(persona: Persona) {
  return { deliver: `${persona}/deliver-sent`, deliveries: `${persona}/deliveries-sent.json` };
}

/** Where MVP 3's own files live, relative to the fixtures directory. */
export const MVP3_PATHS = {
  sentDeliver: sentDeliveryPaths("maria").deliver,
  sentDeliveries: sentDeliveryPaths("maria").deliveries,
  homeMail: `${MARIA_HOME}/mail`,
  homeEnvelopes: `${MARIA_HOME}/envelopes.json`,
  questions: "assistant/questions.json",
} as const;

/** The directories the MVP 3 generator owns beyond format.ts's (main.ts deletes stale files). */
export const MVP3_DIRS = [MARIA_HOME];

/** Maria's profiles in MVP 3: the one she confirmed in MVP 1 S4 and the one S1 confirms. */
export const MARIA_PROFILES = {
  first: "My job search",
  germany: "Germany permanent",
} as const;
export type MariaProfile = (typeof MARIA_PROFILES)[keyof typeof MARIA_PROFILES];

/** The hint Maria types in S1's Re-run setup (focus.v1's key in ai/focus.json). */
export const MARIA_RERUN_HINT = "I've moved to Germany, permanent roles only";

/** packages/schema's ApplicationStage (F5.1). */
export type ApplicationStage =
  | "new"
  | "replied"
  | "applied"
  | "interview"
  | "assessment"
  | "offer"
  | "rejected"
  | "closed";

/** One role of the pipeline as S6 expects it: a thread, or one role from two agencies. */
interface ExpectedPipelineItem {
  /** A name for the scenario to use ("offer", "two-agencies", …). */
  id: string;
  /** Its delivery ids (deliveries.json), oldest first. */
  deliveries: string[];
  /** Its roles as "<Message-ID>#<position>", in the same order. */
  roles: string[];
  title: string;
  company: string;
  /** The stage derived from its mail (F5.1). */
  stage: ApplicationStage;
  /** Whether it is flagged for no reply in 21 days (F5.2). */
  flagged: boolean;
  /** The sender addresses the pipeline names for it (F5.3: both agencies). */
  senders: string[];
}

/** What the re-run with MARIA_RERUN_HINT proposes at least (S1): her replies say it. */
interface ExpectedRerun {
  hint: string;
  /** focus.v1's answer for the hint. */
  focus: FocusAnswer;
  /** Values the new intake form proposes, among others it may have (by core key). */
  proposes: Partial<ProfileValues>;
  /** The replies (deliveries-sent.json ids) that state them: the intake's evidence. */
  evidence: string[];
}

/** expected.json's `mvp3` (Maria's only). */
export interface ExpectedMvp3 {
  /** The profile names: MARIA_PROFILES. */
  profiles: typeof MARIA_PROFILES;
  /** F1.4: the profile every S1 role is assigned to once S1 confirms "Germany permanent". */
  assignments: Record<string, MariaProfile>;
  rerun: ExpectedRerun;
  pipeline: ExpectedPipelineItem[];
  /** S6 moves this pipeline item to this stage by hand; it stays there after the next sync. */
  manualStage: { item: string; stage: ApplicationStage };
  /** The ground truth of the replies `seed deliver S1` appends to Sent, by Message-ID. */
  sent: Record<string, ExpectedMessageAll>;
  /** Maria's personal mailbox (maria-home): its address and every message's ground truth. */
  home: { address: string; messages: Record<string, ExpectedMessageAll> };
}

/** expected.json from MVP 3 on: Maria's has `mvp3`, Tom's doesn't. */
export type ExpectedFileMvp3 = ExpectedFileMvp2 & { mvp3?: ExpectedMvp3 };

/** One lookup assistant.v1 asks for (packages/schema AssistantLookup), every field written. */
export interface Lookup {
  tool: "waiting" | "find_roles" | "role" | "pipeline" | "message_text" | "profile";
  words: string | null;
  messageId: string | null;
  position: number | null;
  stage: string | null;
  days: number | null;
}

/** One question of assistant/questions.json (F8): who asks, and what a right answer gives. */
export interface AssistantQuestion {
  id: string;
  language: "en" | "de" | "pt";
  /** Maria (Everything) or Tom (Job pipeline only, S7). */
  asker: "maria" | "tom";
  text: string;
  /** The scenario that types it (S7, S9), or null for the real-AI quality run only. */
  scenario: string | null;
  /** The read-only lookups the question needs (the fake AI's assistant.v1 answer). */
  lookups: Lookup[];
  expected: {
    /** What a right answer says, in words. */
    says: string;
    /** The number it must give, if it gives one. */
    count: number | null;
    /** Links it must give. */
    links: AnswerAnswer["sources"];
    /** True: its links are exactly what its lookups return, whatever the run left open. */
    linksAreLookups: boolean;
    /** True: it must not show any message's text (a pipeline-only member, F8.3). */
    withholdsBody: boolean;
    /** True: quoted mail asks for actions, and the answer takes none (F8.4). */
    ignoresMailInstructions: boolean;
  };
}
