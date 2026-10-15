import type {
  Category,
  Change,
  ChangeLine,
  DraftStatus,
  Impact,
  JobFacts,
  MatchAiOutput,
  NeedSpec,
  ProfileEntry,
  ProfileSnapshot,
  Rule,
  SenderVerdict,
} from "@jobfilly/schema";
import { matchRole } from "../match/match";
import { replyEligibility } from "../policy/reply";
import {
  answeredFor,
  applyChanges,
  type ChangeContext,
  type ChangeError,
  type ProfileContent,
} from "../profile/changes";
import { changeLines } from "./words";

// The impact preview of a proposal (F8.2, F8.5): the profile and rules with the changes applied
// (the pinned Change semantics of applyChanges), run against the current roles with the real
// rules engine and match, before and after. Pure and without the model: each role is scored with
// its stored match.v1 answer, the same one before and after, so only the change makes a
// difference. A change to the target roles or the profile's skills changes what match.v1 would
// see; the preview still uses the stored answer, and the re-evaluation after Apply asks the model.
//
// It counts the roles the change hides and shows, the scores that move, the drafts that won't be
// created (the reply policy's replyEligibility, with each role's draft history, so a role whose
// draft was discarded or that already has one never counts as a new draft), and the drafts
// already in the mailbox among the roles the change affects: an applied change never touches
// them, and the card says so.

/** One current role as the preview reads it (packages/db's listRoleStates, with its CV skills). */
export interface PreviewRole {
  messageId: string;
  position: number;
  receivedAt: Date | string;
  category: Category | null;
  senderAddress: string;
  facts: JobFacts;
  /** The CV its evaluation chose (cvId null and no skills while none). */
  cv: { cvId: string | null; skills: readonly string[] };
  /** Its stored match.v1 answer; null when it has none. */
  ai: MatchAiOutput | null;
  /** Null while the sender check is missing. */
  senderVerdict: SenderVerdict | null;
  /** Its live (not discarded) draft. */
  draft: { status: DraftStatus | string } | null;
  draftHistory: { hadDraft: boolean; dismissed: boolean };
}

export interface ImpactPreviewInput {
  /** The profile's entries and rules now. */
  content: ProfileContent;
  changes: readonly Change[];
  /** How the changes would be applied (source assistant, the user, the time, rule ids). */
  ctx: ChangeContext;
  roles: readonly PreviewRole[];
  now: Date;
}

/** What the change does to one role. */
export interface RoleImpact {
  messageId: string;
  position: number;
  hidden: { before: boolean; after: boolean };
  score: { before: number; after: number };
  /** It would have got an automatic draft, and won't. */
  draftNotCreated: boolean;
  /** The change affects it and its draft is already in the mailbox, where it stays. */
  draftInMailbox: boolean;
}

export type ImpactPreview =
  | {
      ok: true;
      before: ProfileSnapshot;
      after: ProfileSnapshot;
      lines: ChangeLine[];
      impact: Impact;
      /** Only the roles the change affects. */
      roles: RoleImpact[];
    }
  | { ok: false; error: ChangeError };

/** The draft statuses of a draft that is in the mailbox's Drafts folder. */
const IN_MAILBOX: ReadonlySet<string> = new Set<DraftStatus>(["in_mailbox", "edited"]);

interface Outcome {
  hidden: boolean;
  score: number;
  effects: string;
  eligible: boolean;
}

function outcome(
  role: PreviewRole,
  entries: readonly ProfileEntry[],
  rules: readonly Rule[],
  now: Date,
): Outcome {
  const profile = { entries };
  const result = matchRole({
    facts: role.facts,
    senderAddress: role.senderAddress,
    category: role.category,
    profile,
    rules,
    cv: role.cv,
    ai: role.ai,
  });
  // Needs the profile doesn't answer yet hold the reply back (an ask_first need is per message).
  const openNeeds = [...result.match.verdicts, ...result.ruleEffects]
    .map((v) => v.need)
    .filter((n): n is NeedSpec => n !== null)
    .filter((n) => n.profileKey === null || answeredFor(profile, n.groupKey) === null);
  const eligibility = replyEligibility({
    origin: "auto",
    category: role.category,
    receivedAt: role.receivedAt,
    now,
    profile,
    score: result.match.score,
    capped: result.match.capped,
    senderVerdict: role.senderVerdict,
    ruleEffects: result.ruleEffects,
    openNeeds,
    draftHistory: role.draftHistory,
  });
  return {
    hidden: result.hidden !== null,
    score: result.match.score,
    effects: JSON.stringify(result.ruleEffects.map((e) => [e.ruleId, e.action])),
    eligible: eligibility.eligible,
  };
}

/** The impact of `changes` on the current roles. Pure: it never calls the model. */
export function previewImpact(input: ImpactPreviewInput): ImpactPreview {
  const applied = applyChanges(input.content, input.changes, input.ctx);
  if (!applied.ok) return applied;
  const impact: Impact = {
    hides: 0,
    shows: 0,
    scoreMoves: 0,
    draftsNotCreated: 0,
    draftsInMailbox: 0,
  };
  const roles: RoleImpact[] = [];
  for (const role of input.roles) {
    const was = outcome(role, input.content.entries, input.content.rules, input.now);
    const will = outcome(role, applied.entries, applied.rules, input.now);
    const affected =
      was.hidden !== will.hidden ||
      was.score !== will.score ||
      was.effects !== will.effects ||
      was.eligible !== will.eligible;
    if (!affected) continue;
    const draftNotCreated = was.eligible && !will.eligible;
    const draftInMailbox = role.draft !== null && IN_MAILBOX.has(role.draft.status);
    if (!was.hidden && will.hidden) impact.hides += 1;
    if (was.hidden && !will.hidden) impact.shows += 1;
    if (was.score !== will.score) impact.scoreMoves += 1;
    if (draftNotCreated) impact.draftsNotCreated += 1;
    if (draftInMailbox) impact.draftsInMailbox += 1;
    roles.push({
      messageId: role.messageId,
      position: role.position,
      hidden: { before: was.hidden, after: will.hidden },
      score: { before: was.score, after: will.score },
      draftNotCreated,
      draftInMailbox,
    });
  }
  return {
    ok: true,
    before: applied.before,
    after: applied.after,
    lines: changeLines(applied.before, applied.after),
    impact,
    roles,
  };
}
