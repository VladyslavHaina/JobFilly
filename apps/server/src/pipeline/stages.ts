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

/** @public One job message as the stages read it (packages/db's loadMessageInputs). */
export type MessageInput = MessageInputRow;

/** @public One role of the message: its position and facts. */
export interface RoleInput {
  position: number;
  facts: JobFacts;
}

/**
 * What every stage gets besides its input. `body()` fetches the message's plain text from the
 * mailbox on first call (once per evaluation, never stored); `original()` fetches what a draft
 * replies to (fetchOriginal). Only the sender stage, and the reply stage when it drafts, should
 * call them: re-scoring after a change never touches the mailbox.
 */
export interface StageContext {
  deps: AppDeps;
  ws: string;
  /** The workspace's confirmed profile; null before the intake is confirmed. */
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

export type SenderStage = (
  input: { message: MessageInput },
  ctx: StageContext,
) => Promise<SenderCheck>;

export type CvChoiceStage = (
  input: { message: MessageInput; role: RoleInput },
  ctx: StageContext,
) => Promise<CvChoiceResult>;

/** Rules and match for one role; returns its evaluation (stored as current by the pipeline). */
export type MatchStage = (
  input: { message: MessageInput; role: RoleInput; cvChoice: CvChoiceResult },
  ctx: StageContext,
) => Promise<Omit<RoleEvaluation, "stale" | "evaluatedAt">>;

/** @public What the reply stage gets. */
export interface ReplyStageInput {
  message: MessageInput;
  /** The sender check; null while it is missing or stale (no draft is made without one). */
  sender: SenderCheck | null;
  /** The current evaluation of every role that has one, in position order. */
  evaluations: RoleEvaluation[];
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
