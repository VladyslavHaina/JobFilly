import {
  type ChangeError,
  changeLines,
  editedSummary,
  knownSources,
  rewordEdited,
  rewordProposed,
} from "@jobfilly/core";
import {
  createThread,
  decideProposal,
  getAiSettings,
  getLatestThread,
  getProposal,
  getThread,
  insertProposal,
  listJobMailLanguages,
  listProfiles,
  listRules,
  listThreadMessages,
  listThreadProposals,
  nextTurn,
  type StoredAssistantMessage,
  type StoredProposal,
  saveTurn,
  updateOpenProposal,
} from "@jobfilly/db";
import {
  type AiError,
  type AnswerSource,
  type AssistantAnswer,
  type AssistantClarify,
  AssistantOutputSchema,
  type AssistantSend,
  type AssistantState,
  type AssistantTurn,
  type Change,
  type MemberScope,
  type Profile,
  type Proposal,
  type Rule,
  type TaskId,
  type User,
} from "@jobfilly/schema";
import { aiClientFor } from "../ai-usage";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { applyAndReevaluate } from "../profile/changes";
import { openAiKey } from "../secrets";
import { linksOf, resolveLinks } from "./links";
import { runLookups } from "./lookups";
import { previewChanges } from "./preview";
import { fail, inTransaction, NOT_FOUND_FAILURE, type Result, refuse } from "./result";

// The assistant (F8): one member's conversation, the proposals it makes and what the member does
// with them. The model can only propose (assistant.v1): a proposal is a list of Changes to one
// profile's rules and entries, stored with its impact preview, and nothing changes until an
// editor applies it through the profile change service (source assistant, with the words that
// led to it), or edits it first. Anything the model answers outside rules and profile entries is
// refused, never stored as a proposal.
//
// MVP 3 (F8): a question is answered instead. assistant.v1 asks for read-only lookups, the server
// runs them with the member's access (./lookups) and answer.v1 answers from their results only,
// with the refs it used; only refs the lookups returned are kept, and they become the answer's
// links when the thread is read (./links). A question's turn never holds a proposal, so nothing a
// mail says can become a change (F8.4).
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

const SEVERAL_PROFILES = "You have more than one profile.";
const WHICH_PROFILE = "Which profile is this change for?";

/**
 * The profile a request is about (MVP 3, F1.2): the one the message names, else the one an
 * earlier message of the thread named, else the one the thread's latest proposal changed, else
 * the only one. With several and none of these, it is ambiguous: the first that is on stands in
 * for the model, and a proposal is not made but asked about (WHICH_PROFILE).
 */
async function targetProfile(
  deps: AppDeps,
  ws: string,
  text: string,
  earlier: readonly StoredAssistantMessage[],
  proposals: readonly StoredProposal[],
): Promise<{ profile: Profile | null; ambiguous: boolean; confirmed: Profile[] }> {
  const confirmed = (await listProfiles(deps.db, ws)).filter((p) => p.confirmedAt !== null);
  const found = (profile: Profile | undefined | null) => ({
    profile: profile ?? null,
    ambiguous: false,
    confirmed,
  });
  if (confirmed.length <= 1) return found(confirmed[0]);
  const named = (words: string) =>
    confirmed
      .filter((p) => words.toLocaleLowerCase().includes(p.name.toLocaleLowerCase()))
      .sort((a, b) => b.name.length - a.name.length)[0];
  const said = [
    text,
    ...earlier
      .filter((m) => m.role === "user")
      .map((m) => m.text)
      .reverse(),
  ];
  for (const words of said) {
    const profile = named(words);
    if (profile) return found(profile);
  }
  const last = confirmed.find((p) => p.id === proposals.at(-1)?.profileId);
  if (last) return found(last);
  const first = confirmed.find((p) => p.enabled !== false) ?? confirmed[0];
  return { profile: first ?? null, ambiguous: true, confirmed };
}

/**
 * An earlier turn as the model reads it: an answer with the refs it used, so a follow-up ("show
 * me that message") can name them.
 */
function historyItem(m: StoredAssistantMessage) {
  const refs = m.sources.map((s) => `${s.kind} ${s.ref}`).join(", ");
  return { role: m.role, text: refs ? `${m.text}\n(refs: ${refs})` : m.text };
}

/** Why the model gave no answer, logged in codes packages/ai prepared; never any words. */
function aiFailed(log: Logger, task: TaskId, error: AiError): Result<never> {
  const { kind, httpStatus, providerErrorType } = error;
  log.warn("assistant.failed", {
    task,
    reason: kind,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(providerErrorType !== undefined ? { providerErrorType } : {}),
  });
  return fail(502, "ai_failed", "The assistant couldn't answer. Try again.");
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

/**
 * The member's latest thread with its messages and proposals (GET /assistant), each answer with
 * the links the member may follow now (`scope`, D14).
 */
export async function assistantState(
  deps: AppDeps,
  ws: string,
  user: User,
  scope: MemberScope,
): Promise<AssistantState> {
  const thread = await getLatestThread(deps.db, ws, user.id);
  if (!thread) return { thread: null };
  const [messages, proposals] = await Promise.all([
    listThreadMessages(deps.db, ws, thread.id),
    listThreadProposals(deps.db, ws, thread.id),
  ]);
  const links = await resolveLinks(
    deps,
    ws,
    scope,
    messages.flatMap((m) => m.sources),
  );
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
        ...(m.role === "assistant" ? { links: linksOf(m.sources, links) } : {}),
      })),
      proposals: proposals.map(toProposal),
    },
  };
}

type Target = Awaited<ReturnType<typeof targetProfile>>;
type Preview = Extract<Awaited<ReturnType<typeof previewChanges>>, { ok: true }>;

/** What a turn stores: the reply, and a question, a proposal with its preview, or sources. */
interface Outcome {
  text: string;
  clarify: AssistantClarify | null;
  proposal: { summary: string; changes: Change[]; profile: Profile; preview: Preview } | null;
  sources: AnswerSource[];
  /** The lookups a question was answered from, by tool; [] for any other turn. */
  lookups: string[];
}

/**
 * A request to change preferences (F8.2): the model's proposal for the target profile, kept only
 * when it is a list of rule and entry changes that apply to it, and asked about when it isn't
 * clear which profile the user means.
 */
async function proposalOutcome(
  deps: AppDeps,
  ws: string,
  user: User,
  answer: AssistantAnswer,
  target: Target,
  rules: Rule[],
): Promise<Outcome> {
  const none = { proposal: null, sources: [], lookups: [] };
  let text = answer.reply;
  const clarify: AssistantClarify | null = answer.clarify;
  // packages/ai lets through a proposal with changes outside rules and entries (a mailbox, a
  // member…): it is refused here, alone, and the reply says so.
  const inScope = PROPOSAL.safeParse(clarify ? null : answer.proposal);
  if (!inScope.success) return { ...none, text: `${text}\n\n${OUTSIDE}`, clarify };
  if (!inScope.data || inScope.data.changes.length === 0) return { ...none, text, clarify };
  const { profile } = target;
  if (!profile) return { ...none, text: `${text}\n\n${NO_PROFILE}`, clarify };
  if (target.ambiguous) {
    return {
      ...none,
      text: SEVERAL_PROFILES,
      clarify: { question: WHICH_PROFILE, choices: target.confirmed.map((p) => p.name) },
    };
  }
  const changes = rewordProposed(inScope.data.changes, rules);
  const preview = await previewChanges(deps, ws, { profile, rules, changes, userId: user.id });
  if (!preview.ok) {
    return { ...none, text: `${text}\n\n${OUTSIDE} ${errorWords(preview.error)}`, clarify };
  }
  if (target.confirmed.length > 1) text = `${text}\n\nThis is for your profile "${profile.name}".`;
  return {
    ...none,
    text,
    clarify,
    proposal: { summary: inScope.data.summary, changes, profile, preview },
  };
}

/**
 * Sends one message (POST /assistant): asks assistant.v1 with the target profile, its rules, the
 * earlier turns and the languages of the workspace's job mail, then stores the turn and, for a
 * request to change preferences, a proposal with its impact preview. An unclear request gets the
 * model's clarifying question and no proposal. A question is answered from the lookups the model
 * asked for, run with the member's access (`scope`), by answer.v1. Nothing is stored when the
 * model gives no answer.
 */
export async function sendMessage(
  deps: AppDeps,
  ws: string,
  user: User,
  scope: MemberScope,
  input: AssistantSend,
  log: Logger,
): Promise<Result<AssistantTurn>> {
  const thread = input.threadId ? await getThread(deps.db, ws, user.id, input.threadId) : null;
  if (input.threadId && !thread) return NOT_FOUND_FAILURE;
  const settings = await getAiSettings(deps.db, ws);
  if (!settings) return fail(409, "no_ai", "Set up an AI provider under Settings › AI first.");

  const [earlier, proposals] = thread
    ? await Promise.all([
        listThreadMessages(deps.db, ws, thread.id),
        listThreadProposals(deps.db, ws, thread.id),
      ])
    : [[], []];
  const target = await targetProfile(deps, ws, input.text, earlier, proposals);
  const { profile } = target;
  const rules = profile ? await listRules(deps.db, ws, profile.id) : [];
  const turn = thread ? await nextTurn(deps.db, ws, thread.id) : 1;
  const history = earlier.map(historyItem);
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
    // So a rule on free text gets its phrases in each language the mail is written in.
    mailLanguages: await listJobMailLanguages(deps.db, ws),
  });
  if (!result.ok) return aiFailed(log, "assistant.v1", result.error);

  let outcome: Outcome;
  if (result.data.lookups.length > 0) {
    // A question (F8.1): answered from the lookups' results only, never with a proposal.
    const results = await runLookups(deps, ws, scope, result.data.lookups);
    const answer = await client.answer({ turn, text: input.text, history, results });
    if (!answer.ok) return aiFailed(log, "answer.v1", answer.error);
    outcome = {
      text: answer.data.text,
      clarify: null,
      proposal: null,
      sources: knownSources(answer.data.sources, results),
      lookups: results.map((r) => r.lookup.tool),
    };
  } else {
    outcome = await proposalOutcome(deps, ws, user, result.data, target, rules);
  }
  const { text, clarify, proposal, sources } = outcome;

  const at = deps.clock.now();
  const saved = await deps.db.transaction(async (tx) => {
    const threadId = thread?.id ?? (await createThread(tx, ws, user.id, at)).id;
    const stored = proposal
      ? await insertProposal(tx, ws, {
          threadId,
          profileId: proposal.profile.id,
          request: input.text,
          summary: proposal.summary,
          changes: proposal.changes,
          before: proposal.preview.before,
          after: proposal.preview.after,
          impact: proposal.preview.impact,
          at,
        })
      : null;
    await saveTurn(tx, ws, threadId, {
      turn,
      text: input.text,
      reply: text,
      clarify,
      proposalId: stored?.id ?? null,
      sources,
      at,
    });
    return { threadId, proposalId: stored?.id ?? null };
  });

  log.info("assistant.message", { threadId: saved.threadId });
  if (outcome.lookups.length > 0) {
    // The tools and how many refs the answer kept: never the question, the answer or a ref.
    log.info("assistant.answered", {
      threadId: saved.threadId,
      lookups: outcome.lookups,
      sources: sources.length,
    });
  }
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
