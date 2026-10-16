import {
  type ChangeError,
  changeLines,
  editedSummary,
  rewordEdited,
  rewordProposed,
} from "@jobfilly/core";
import {
  createThread,
  type Database,
  decideProposal,
  getAiSettings,
  getLatestThread,
  getProposal,
  getThread,
  insertProposal,
  listProfiles,
  listRules,
  listThreadMessages,
  listThreadProposals,
  nextTurn,
  type StoredProposal,
  saveTurn,
  updateOpenProposal,
} from "@jobfilly/db";
import {
  type AssistantClarify,
  AssistantOutputSchema,
  type AssistantSend,
  type AssistantState,
  type AssistantTurn,
  type Change,
  type Profile,
  type Proposal,
  type User,
} from "@jobfilly/schema";
import { aiClientFor } from "../ai-usage";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { applyAndReevaluate } from "../profile/changes";
import { openAiKey } from "../secrets";
import { previewChanges } from "./preview";
import { fail, inTransaction, NOT_FOUND_FAILURE, type Result, refuse } from "./result";

// The assistant (F8): one member's conversation, the proposals it makes and what the member does
// with them. The model can only propose (assistant.v1): a proposal is a list of Changes to the
// profile's rules and entries, stored with its impact preview, and nothing changes until an
// editor applies it through the profile change service (source assistant, with the words that
// led to it), or edits it first. Anything the model answers outside rules and profile entries is
// refused, never stored as a proposal.
//
// Messages, replies, summaries and requests are stored for the history and never logged (F8.10):
// the log lines carry ids and counts only.

const DECIDED = fail(409, "decided", "This proposal was already applied or discarded.");

/** A proposal made only of rule and entry changes, or none: the only kind ever stored. */
const PROPOSAL = AssistantOutputSchema.shape.proposal;

/** What the reply says when the model's proposal can't be one (F8.7). */
const OUTSIDE =
  "I can only propose changes to your rules and profile entries, so nothing was proposed.";
const NO_PROFILE =
  "Your profile isn't confirmed yet: confirm it on the Intake page, then I can propose changes to it.";

/** The workspace's confirmed profile (one per workspace in MVP 2), or null. */
async function confirmedProfile(db: Database, ws: string): Promise<Profile | null> {
  return (await listProfiles(db, ws)).find((p) => p.confirmedAt !== null) ?? null;
}

function errorWords(error: ChangeError): string {
  return error.kind === "unknown_rule"
    ? "It changes a rule that no longer exists."
    : `The value for ${error.key} isn't valid: ${error.message}`;
}

function toProposal(stored: StoredProposal): Proposal {
  return {
    id: stored.id,
    summary: stored.summary,
    changes: stored.changes,
    before: stored.before,
    after: stored.after,
    lines: changeLines(stored.before, stored.after),
    impact: stored.impact,
    status: stored.status,
    createdAt: stored.createdAt.toISOString(),
  };
}

/** The member's latest thread with its messages and proposals (GET /assistant). */
export async function assistantState(
  deps: AppDeps,
  ws: string,
  user: User,
): Promise<AssistantState> {
  const thread = await getLatestThread(deps.db, ws, user.id);
  if (!thread) return { thread: null };
  const [messages, proposals] = await Promise.all([
    listThreadMessages(deps.db, ws, thread.id),
    listThreadProposals(deps.db, ws, thread.id),
  ]);
  return {
    thread: {
      id: thread.id,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        clarify: m.clarify,
        proposalId: m.proposalId,
        at: m.at.toISOString(),
      })),
      proposals: proposals.map(toProposal),
    },
  };
}

/**
 * Sends one message (POST /assistant): asks assistant.v1 with the profile, its rules and the
 * earlier turns, then stores the turn and, for a request to change preferences, a proposal with
 * its impact preview. An unclear request gets the model's clarifying question and no proposal.
 * Nothing is stored when the model gives no answer.
 */
export async function sendMessage(
  deps: AppDeps,
  ws: string,
  user: User,
  input: AssistantSend,
  log: Logger,
): Promise<Result<AssistantTurn>> {
  const thread = input.threadId ? await getThread(deps.db, ws, user.id, input.threadId) : null;
  if (input.threadId && !thread) return NOT_FOUND_FAILURE;
  const settings = await getAiSettings(deps.db, ws);
  if (!settings) return fail(409, "no_ai", "Set up an AI provider under Settings › AI first.");

  const profile = await confirmedProfile(deps.db, ws);
  const rules = profile ? await listRules(deps.db, ws, profile.id) : [];
  const turn = thread ? await nextTurn(deps.db, ws, thread.id) : 1;
  const history = thread
    ? (await listThreadMessages(deps.db, ws, thread.id)).map((m) => ({
        role: m.role,
        text: m.text,
      }))
    : [];
  const client = aiClientFor(deps, ws, {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    models: settings.models,
    apiKey: openAiKey(deps.config.secretKey, settings.keyCiphertext),
  });
  const result = await client.assistant({
    turn,
    text: input.text,
    history,
    entries: (profile?.entries ?? []).map((e) => ({ key: e.key, label: e.label, value: e.value })),
    rules,
  });
  if (!result.ok) {
    // Why, in codes packages/ai prepared for the logs; never the message or the provider's words.
    const { kind, httpStatus, providerErrorType } = result.error;
    log.warn("assistant.failed", {
      task: "assistant.v1",
      reason: kind,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(providerErrorType !== undefined ? { providerErrorType } : {}),
    });
    return fail(502, "ai_failed", "The assistant couldn't answer. Try again.");
  }

  let text = result.data.reply;
  const clarify: AssistantClarify | null = result.data.clarify;
  // packages/ai lets through a proposal with changes outside rules and entries (a mailbox, a
  // member…): it is refused here, alone, and the reply says so.
  const inScope = PROPOSAL.safeParse(clarify ? null : result.data.proposal);
  let proposal: { summary: string; changes: Change[] } | null = inScope.data
    ? { ...inScope.data, changes: rewordProposed(inScope.data.changes, rules) }
    : null;
  if (!inScope.success) text = `${text}\n\n${OUTSIDE}`;
  if (proposal && proposal.changes.length === 0) proposal = null;
  if (proposal && !profile) {
    text = `${text}\n\n${NO_PROFILE}`;
    proposal = null;
  }
  const preview =
    proposal && profile
      ? await previewChanges(deps, ws, {
          profile,
          rules,
          changes: proposal.changes,
          userId: user.id,
        })
      : null;
  if (preview && !preview.ok) {
    text = `${text}\n\n${OUTSIDE} ${errorWords(preview.error)}`;
    proposal = null;
  }

  const at = deps.clock.now();
  const saved = await deps.db.transaction(async (tx) => {
    const threadId = thread?.id ?? (await createThread(tx, ws, user.id, at)).id;
    const stored =
      proposal && profile && preview?.ok
        ? await insertProposal(tx, ws, {
            threadId,
            profileId: profile.id,
            request: input.text,
            summary: proposal.summary,
            changes: proposal.changes,
            before: preview.before,
            after: preview.after,
            impact: preview.impact,
            at,
          })
        : null;
    await saveTurn(tx, ws, threadId, {
      turn,
      text: input.text,
      reply: text,
      clarify,
      proposalId: stored?.id ?? null,
      at,
    });
    return { threadId, proposalId: stored?.id ?? null };
  });

  log.info("assistant.message", { threadId: saved.threadId });
  let card: Proposal | null = null;
  if (saved.proposalId && proposal) {
    log.info("assistant.proposal_created", {
      proposalId: saved.proposalId,
      changes: proposal.changes.length,
    });
    const stored = await getProposal(deps.db, ws, saved.proposalId);
    card = stored ? toProposal(stored) : null;
  }
  await deps.live.publish(ws, { type: "assistant.updated", data: {} });
  return { ok: true, data: { threadId: saved.threadId, reply: text, clarify, proposal: card } };
}

/** The member's own proposal, or null: nobody acts on another member's conversation. */
async function ownProposal(deps: AppDeps, ws: string, user: User, proposalId: string) {
  const stored = await getProposal(deps.db, ws, proposalId);
  return stored && stored.userId === user.id ? stored : null;
}

/** The profile and rules a proposal changes, or null when the profile is gone. */
async function proposalProfile(deps: AppDeps, ws: string, stored: StoredProposal) {
  const profile = (await listProfiles(deps.db, ws)).find((p) => p.id === stored.profileId);
  return profile ? { profile, rules: await listRules(deps.db, ws, profile.id) } : null;
}

/**
 * Edits an open proposal before Apply (PATCH, F8.2): the card's changes, e.g. the time-zone
 * range. A rule whose conditions changed is reworded, the summary follows the edit, and the
 * impact is previewed again.
 */
export async function editProposal(
  deps: AppDeps,
  ws: string,
  user: User,
  proposalId: string,
  edited: Change[],
): Promise<Result<Proposal>> {
  const stored = await ownProposal(deps, ws, user, proposalId);
  if (!stored) return NOT_FOUND_FAILURE;
  if (stored.status !== "open") return DECIDED;
  const target = await proposalProfile(deps, ws, stored);
  if (!target) return NOT_FOUND_FAILURE;
  const changes = rewordEdited(stored.changes, edited);
  const preview = await previewChanges(deps, ws, { ...target, changes, userId: user.id });
  if (!preview.ok) return fail(400, "invalid", errorWords(preview.error));
  const summary = editedSummary(stored, changes, target.rules);
  const at = deps.clock.now();
  const updated = await updateOpenProposal(deps.db, ws, proposalId, {
    summary,
    changes,
    before: preview.before,
    after: preview.after,
    impact: preview.impact,
    at,
  });
  if (!updated) return DECIDED;
  await deps.live.publish(ws, { type: "assistant.updated", data: {} });
  const fresh = await getProposal(deps.db, ws, proposalId);
  return fresh ? { ok: true, data: toProposal(fresh) } : NOT_FOUND_FAILURE;
}

/**
 * Applies an open proposal (POST …/apply, F8.3): an editor's separate request. The proposal is
 * marked applied and its changes saved through the profile change service (source assistant,
 * with the request that led to it) in one transaction, so a proposal is applied once; every role
 * is then re-evaluated. Drafts already in the mailbox are never touched (F8.5): nothing here
 * writes a draft, and the re-evaluation's reply policy never recreates one a role had.
 */
export async function applyProposal(
  deps: AppDeps,
  ws: string,
  user: User,
  proposalId: string,
  log: Logger,
): Promise<Result<Proposal>> {
  const stored = await ownProposal(deps, ws, user, proposalId);
  if (!stored) return NOT_FOUND_FAILURE;
  if (stored.status !== "open") return DECIDED;
  const at = deps.clock.now();
  const done = await inTransaction(deps, async (tx) => {
    const decided = await decideProposal(tx.db, ws, proposalId, {
      status: "applied",
      userId: user.id,
      at,
    });
    if (!decided) refuse(DECIDED);
    const result = await applyAndReevaluate(tx, ws, stored.profileId, stored.changes, {
      source: "assistant",
      userId: user.id,
      request: stored.request,
    });
    if (!result) refuse(NOT_FOUND_FAILURE);
    if (!result.ok) {
      refuse(
        fail(
          409,
          "stale",
          `This proposal no longer fits your profile. ${errorWords(result.error)}`,
        ),
      );
    }
    await tx.live.publish(ws, { type: "assistant.updated", data: {} });
  });
  if (!done.ok) return done;
  log.info("assistant.proposal_applied", { proposalId });
  const fresh = await getProposal(deps.db, ws, proposalId);
  return fresh ? { ok: true, data: toProposal(fresh) } : NOT_FOUND_FAILURE;
}

/** Discards an open proposal (POST …/discard): nothing changes. Viewers may discard their own. */
export async function discardProposal(
  deps: AppDeps,
  ws: string,
  user: User,
  proposalId: string,
  log: Logger,
): Promise<Result<Proposal>> {
  const stored = await ownProposal(deps, ws, user, proposalId);
  if (!stored) return NOT_FOUND_FAILURE;
  const decided = await decideProposal(deps.db, ws, proposalId, {
    status: "discarded",
    userId: user.id,
    at: deps.clock.now(),
  });
  if (!decided) return DECIDED;
  log.info("assistant.proposal_discarded", { proposalId });
  await deps.live.publish(ws, { type: "assistant.updated", data: {} });
  const fresh = await getProposal(deps.db, ws, proposalId);
  return fresh ? { ok: true, data: toProposal(fresh) } : NOT_FOUND_FAILURE;
}
