import type { DraftHistory, MessageInputRow } from "@jobfilly/db";
import type {
  JobFacts,
  OriginalMessage,
  Profile,
  RoleEvaluation,
  Rule,
  SenderCheck,
} from "@jobfilly/schema";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";

// The analysis pipeline's stage contract (ARCHITECTURE › The analysis pipeline), pinned by the
// foundation. evaluateMessage (./evaluate.ts) runs, for one job message: the sender stage, then
// per role the cv-choice and match stages, then the reply stage. Each stage's real body lives in
// its own file and belongs to one slice:
//
//   sender.ts     cvs-senders   SenderStage    the sender check (F5)
//   cv-choice.ts  cvs-senders   CvChoiceStage  the CV the app would use for a role (F2.3)
//   match.ts      rules-match   MatchStage     rules and the explainable match (F3, F4)
//   reply.ts      replies       ReplyStage     a draft, or decisions for what it needs (F6, F7)
//
// Tests inject their own stages, so the backbone is proven without the slices.

/**
 * One job message as the stages read it (packages/db's loadMessageInputs). Its
 * `language` is the body's language as the sender stage last detected it (stored on the
 * message), so the cv-choice stage reads it without the mailbox; null before then.
 */
export type MessageInput = MessageInputRow;

/** One role of the message: its position and facts. */
interface RoleInput {
  position: number;
  facts: JobFacts;
}

/**
 * body() found no message under the stored reference (fetchBody returned null): it was deleted
 * or moved, or its folder was rebuilt and the next sync re-indexes it. The sender stage may catch
 * it and return an incomplete check with what it can still tell (the domain, the mark). If it
 * lets it through, the pipeline stores an incomplete check with only the message_gone reason, so
 * the message isn't tried again on every sweep. Either way the stored check is incomplete, never
 * better than caution, and names message_gone; a scan or sync that sees the message again makes
 * it stale (packages/db saveEnvelopes).
 */
export class MessageGoneError extends Error {
  constructor() {
    super("the message is no longer in the mailbox");
    this.name = "MessageGoneError";
  }
}

/**
 * What every stage gets besides its input. `body()` fetches the message's plain text from the
 * mailbox on first call (once per evaluation, never stored); it throws MessageGoneError when the
 * message isn't there. `original()` fetches what a draft replies to (fetchOriginal). Only the
 * sender stage, and the reply stage when it drafts, should call them: re-scoring after a change
 * never touches the mailbox. A re-evaluation run shares one mailbox connection between its
 * messages.
 */
export interface StageContext {
  deps: AppDeps;
  ws: string;
  /**
   * The profile the stage works with; null before the intake is confirmed. The cv-choice and match
   * stages get the role's own (MVP 3, F1.3: assign.ts); the sender and reply stages the first
   * profile that is on, and the reply stage each role's from its input.
   */
  profile: Profile | null;
  /** The profile's rules, on and off (the engine skips those that are off). */
  rules: Rule[];
  now: Date;
  /** new: just synced; backlog: never evaluated before; reevaluate: a change made it stale. */
  origin: "new" | "backlog" | "reevaluate";
  body(): Promise<string>;
  original(): Promise<OriginalMessage | null>;
  log: Logger;
}

/**
 * What the cv-choice stage hands the match stage: the chosen CV (or none yet, cvId null, when
 * every skill then comes from the profile) and why. The match stage uses `skills` for matched
 * and missing skills (F4.4) and in the hash of its stored match.v1 answer.
 */
export interface CvChoiceResult {
  cvId: string | null;
  name: string | null;
  language: string | null;
  skills: string[];
  reason: string;
  source: "auto" | "you";
}

/**
 * What the sender stage returns: the check, and the body's language (ISO 639-1) as it detected
 * it for its phrase lists, or null when it couldn't tell. The pipeline stores both; when the
 * language changed, the message's roles are evaluated again, as their CV choice may depend on it.
 */
export interface SenderStageResult {
  check: SenderCheck;
  language: string | null;
}

export type SenderStage = (
  input: { message: MessageInput },
  ctx: StageContext,
) => Promise<SenderStageResult>;

export type CvChoiceStage = (
  input: { message: MessageInput; role: RoleInput },
  ctx: StageContext,
) => Promise<CvChoiceResult>;

/** Rules and match for one role; returns its evaluation (stored as current by the pipeline). */
export type MatchStage = (
  input: { message: MessageInput; role: RoleInput; cvChoice: CvChoiceResult },
  ctx: StageContext,
) => Promise<Omit<RoleEvaluation, "stale" | "evaluatedAt">>;

/** What the reply stage gets. */
interface ReplyStageInput {
  message: MessageInput;
  /** The sender check; null while it is missing or stale (no draft is made without one). */
  sender: SenderCheck | null;
  /** The current evaluation of every role that has one, in position order. */
  evaluations: RoleEvaluation[];
  /**
   * MVP 3 (F1.3): the profile each evaluated role was evaluated with, by position; its policy,
   * needs and answers decide the role's reply. A role missing here uses `ctx.profile`.
   */
  profiles?: Map<number, Profile>;
  /** Each role's draft history, by position. */
  draftHistory: Map<number, DraftHistory>;
  /** Whether the message is inside reply_window_days (F1.6). */
  withinReplyWindow: boolean;
}

/**
 * Drafts (draft.create, through the role-level claim) or decisions for the roles that may get a
 * reply, by replyEligibility. draft.create loads the chosen CV through getCv and getCvFile.
 */
export type ReplyStage = (input: ReplyStageInput, ctx: StageContext) => Promise<void>;

export interface Stages {
  sender: SenderStage;
  cvChoice: CvChoiceStage;
  match: MatchStage;
  reply: ReplyStage;
}
