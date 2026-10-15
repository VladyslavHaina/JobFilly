import { saveAnalysis, saveEnvelopes } from "@jobfilly/db";
import type { Category, Envelope, JobFacts, RoleEvaluation, SenderCheck } from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import type { CvChoiceResult, SenderStageResult, Stages } from "../pipeline/stages";
import type { FakeMailbox } from "./mailbox";

// Helpers for pipeline tests (tests only): job mail that exists both in the fake mailbox and in
// the database, as the scan or the sync leaves it, and pipeline stages that record what they were
// asked and answer what the test says.

/** Facts of one role, every field unknown unless given. */
export function roleFacts(overrides: Partial<JobFacts> = {}): JobFacts {
  return {
    title: "Backend Engineer",
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
  };
}

/**
 * A job message delivered to the fake mailbox's INBOX and stored as analysed (category and
 * roles), as if the scan or a sync had read it. Returns its envelope.
 */
export async function seedJobMail(
  deps: AppDeps,
  workspaceId: string,
  mailbox: FakeMailbox,
  input: {
    messageId: string;
    receivedAt: Date;
    roles?: JobFacts[];
    category?: Category;
    from?: string;
    subject?: string;
    text?: string;
  },
): Promise<Envelope> {
  const envelope = mailbox.deliver({
    messageId: input.messageId,
    date: input.receivedAt.toISOString(),
    from: { address: input.from ?? "recruiter@agency.example", name: null },
    subject: input.subject ?? "A role for you",
    text: input.text ?? "Hello Maria, a role for you.",
  });
  await saveEnvelopes(deps.db, workspaceId, [{ envelope, verdict: "likely_job", reason: null }]);
  await saveAnalysis(deps.db, workspaceId, {
    messageId: input.messageId,
    scanId: null,
    category: input.category ?? "recruiter_outreach",
    roles: input.roles ?? [roleFacts()],
  });
  return envelope;
}

export interface RecordingStages extends Stages {
  /** Every stage call in order: "sender <id>", "cvChoice <id>#<pos>", "match …", "reply <id>". */
  calls: string[];
  /** What the reply stage was given, per call. */
  replies: Parameters<Stages["reply"]>[0][];
  /** The score each role gets (default 75); a function of message and position. */
  score: (messageId: string, position: number) => number;
  /** The language the sender stage tells for a message (default null). */
  language: (messageId: string) => string | null;
  /** The language each cv-choice call saw on its message input, as "<id>#<pos> <language>". */
  cvLanguages: string[];
  /** Make a stage fail for a message (or every message with "*"). */
  failing: Partial<Record<"sender" | "cvChoice" | "match" | "reply", string>>;
}

/**
 * Stages that record their calls. The sender stage reads the body (ctx.body()), as the real one
 * does, and lets MessageGoneError through; the match stage scores 75 unless told otherwise.
 */
export function recordingStages(): RecordingStages {
  const fails = (stage: keyof RecordingStages["failing"], id: string) => {
    const target = stages.failing[stage];
    return target === "*" || target === id;
  };
  const stages: RecordingStages = {
    calls: [],
    replies: [],
    failing: {},
    score: () => 75,
    language: () => null,
    cvLanguages: [],
    async sender({ message }, ctx): Promise<SenderStageResult> {
      stages.calls.push(`sender ${message.messageId}`);
      if (fails("sender", message.messageId)) throw new Error("sender stage failed");
      await ctx.body();
      const check: SenderCheck = { verdict: "looks_fine", complete: true, reasons: [], mark: null };
      return { check, language: stages.language(message.messageId) };
    },
    async cvChoice({ message, role }): Promise<CvChoiceResult> {
      stages.calls.push(`cvChoice ${message.messageId}#${role.position}`);
      stages.cvLanguages.push(`${message.messageId}#${role.position} ${message.language}`);
      if (fails("cvChoice", message.messageId)) throw new Error("cv-choice stage failed");
      return {
        cvId: null,
        name: null,
        language: null,
        skills: [],
        reason: "No CV yet",
        source: "auto",
      };
    },
    async match({
      message,
      role,
      cvChoice,
    }): Promise<Omit<RoleEvaluation, "stale" | "evaluatedAt">> {
      stages.calls.push(`match ${message.messageId}#${role.position}`);
      if (fails("match", message.messageId)) throw new Error("match stage failed");
      const score = stages.score(message.messageId, role.position);
      return {
        position: role.position,
        match: {
          score,
          verdicts: [],
          skills: { matched: [], missing: [] },
          cvId: cvChoice.cvId,
          capped: false,
        },
        hidden: null,
        ruleEffects: [],
        cvChoice: { cvId: cvChoice.cvId, reason: cvChoice.reason, source: cvChoice.source },
      };
    },
    async reply(input) {
      stages.calls.push(`reply ${input.message.messageId}`);
      stages.replies.push(input);
      if (fails("reply", input.message.messageId)) throw new Error("reply stage failed");
    },
  };
  return stages;
}
