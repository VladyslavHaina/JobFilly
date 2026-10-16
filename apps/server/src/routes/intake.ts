import {
  buildIntakeExtraInput,
  confirmedEntries,
  extraEvidenceIds,
  foundExtraQuestions,
} from "@jobfilly/core";
import {
  claimIntakeExtras,
  createConfirmedProfile,
  finishIntakeExtras,
  getAiSettings,
  getIntakeExtras,
  getLatestScan,
  getStoredMessages,
  hasProfile,
  listIntakeAnswers,
  loadIntakeInput,
  releaseIntakeExtras,
  saveIntakeAnswer,
  takeOverIntakeExtras,
} from "@jobfilly/db";
import {
  ConfirmIntakeInputSchema,
  DEFAULT_PROFILE_NAME,
  type ExtraQuestion,
  IntakeAnswerInputSchema,
  IntakeAnswerParamsSchema,
  type IntakeEdit,
  type IntakeExtraOutput,
  type IntakeForm,
  type IntakeProposal,
  isExtraKey,
  type Profile,
  profileValueSchema,
  type TaskResult,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import { aiClientFor } from "../ai-usage";
import { MINUTE } from "../clock";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { requestReevaluation } from "../profile/changes";
import { openAiKey } from "../secrets";

// The intake form: proposals, answers, confirm (F6).
// Mounted once at /api/workspaces/:workspaceId/intake; each handler applies its own role.
//
// The form opens once the first scan has stopped. Its core answers are aggregated afresh from
// what the scan stored each time (packages/core), the user's click edits are kept apart in
// intake_answers, and Confirm saves both as the workspace's profile. Later runs ("Analyze them")
// keep filling the proposal but never touch a confirmed profile: it is a separate row.
//
// The extra questions come from one intake.v1 call per workspace (TBD-19): whoever opens the form
// first claims it through the intake_extras row and makes the call in the background
// (deps.background, which shutdown waits for); everyone else sees 'pending' until an
// intake.updated event says it is done. A replica that shuts down before the model answers
// releases the claim, so the next GET takes it over at once; a claim still pending after
// 2 minutes (its replica died) can be taken over by one caller. It is the one model call made
// outside the job queue (docs/ARCHITECTURE.md, "Background work and live updates").

const NOT_READY = {
  error: "not_ready",
  message: "The intake form is ready once the first scan has stopped",
} as const;
const CONFIRMED = {
  error: "confirmed",
  message: "Your profile is already confirmed. Change it on the profile page.",
} as const;
const NO_SUCH_QUESTION = { error: "not_found", message: "There is no such question" } as const;
const EXTRAS_PENDING = {
  error: "extras_pending",
  message: "The questions found in your mail are still on their way. Confirm once they show.",
} as const;

/** A pending claim older than this belongs to a replica that is gone. */
const EXTRAS_CLAIM_STALE_MS = 2 * MINUTE;

/** Whether the first scan has stopped, which opens the form. */
async function formIsOpen(deps: AppDeps, workspaceId: string): Promise<boolean> {
  const first = await getLatestScan(deps.db, workspaceId, "first");
  return first?.status === "stopped";
}

async function proposalOf(deps: AppDeps, workspaceId: string): Promise<IntakeProposal> {
  return deps.intake.aggregate(await loadIntakeInput(deps.db, workspaceId));
}

/** The extra questions once they are found; [] while pending, failed or never asked. */
async function currentQuestions(deps: AppDeps, workspaceId: string): Promise<ExtraQuestion[]> {
  const extras = await getIntakeExtras(deps.db, workspaceId);
  return extras?.status === "done" ? extras.questions : [];
}

type Claim = { instance: string; at: Date };

/**
 * Makes the one intake.v1 call for a claim and stores its outcome. Runs after the response, in
 * deps.background: it never holds a request or a transaction open while the model answers, and
 * shutdown waits for it. Only the questions the mail it was shown backs are kept
 * (foundExtraQuestions).
 *
 * Once the answer is in, its usage is recorded and the claim finished, also while the replica
 * shuts down: shutdown closes the database only after this has returned. Storing the questions
 * can fail even though they passed their schema. That failure is final, not an abandoned claim:
 * the claim is closed as 'failed' with no questions in a second, minimal update, so Confirm isn't
 * held and the call isn't made again. Only when the database can't take that either is the error
 * thrown to the caller, which logs it and leaves the claim pending for the 2-minute takeover.
 *
 * When shutdown aborts `signal` before the answer is in, the call is abandoned and the claim
 * released, so the next GET /intake on any replica takes it over at once.
 */
async function askForExtras(
  deps: AppDeps,
  workspaceId: string,
  proposal: IntakeProposal,
  claim: Claim,
  log: Logger,
  signal: AbortSignal,
): Promise<void> {
  let status: "done" | "failed" = "failed";
  let questions: ExtraQuestion[] = [];
  const settings = await getAiSettings(deps.db, workspaceId);
  if (settings) {
    const input = buildIntakeExtraInput(
      proposal,
      await getStoredMessages(deps.db, workspaceId, extraEvidenceIds(proposal)),
    );
    let result: TaskResult<IntakeExtraOutput> | null = null;
    try {
      signal.throwIfAborted();
      // Records the call's usage as soon as the answer is in (ai-usage.ts).
      const client = aiClientFor(deps, workspaceId, {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        models: settings.models,
        apiKey: openAiKey(deps.config.secretKey, settings.keyCiphertext),
      });
      result = await untilAborted(client.intake(input), signal);
    } catch (error) {
      if (signal.aborted) {
        await releaseIntakeExtras(deps.db, workspaceId, claim.at);
        // Open forms ask again, and the first GET takes the claim over.
        await deps.live.publish(workspaceId, { type: "intake.updated", data: {} });
        return;
      }
      // The client failed outright (a provider failure comes back as a result, not a throw): the
      // form goes on without extra questions.
      log.warn("intake.extras_failed", { workspaceId, error: errorName(error) });
    }
    if (result?.ok) {
      status = "done";
      questions = foundExtraQuestions(result.data.questions, input);
    }
  }
  try {
    await finishIntakeExtras(deps.db, workspaceId, {
      claim,
      status,
      questions,
      at: deps.clock.now(),
    });
  } catch (error) {
    if (status === "failed") throw error;
    log.warn("intake.extras_failed", { workspaceId, error: errorName(error) });
    await finishIntakeExtras(deps.db, workspaceId, {
      claim,
      status: "failed",
      questions: [],
      at: deps.clock.now(),
    });
  }
  await deps.live.publish(workspaceId, { type: "intake.updated", data: {} });
}

/**
 * Waits for `call` until `signal` aborts. packages/ai takes no signal yet, so an aborted call's
 * request is left to end with the process; nothing waits for it or uses its answer.
 */
function untilAborted<T>(call: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    call.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Only an error's name is logged for the background call: a database error's message quotes the
 * query's parameters, which can hold the model's questions, and AI output is never logged.
 */
const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");

/** The extra questions' state for the form, claiming the call when nobody has (yet). */
async function extrasFor(
  deps: AppDeps,
  workspaceId: string,
  proposal: IntakeProposal,
  log: Logger,
): Promise<IntakeForm["extras"]> {
  const now = deps.clock.now();
  const claim = { instance: deps.config.instance, at: now };
  let state = await getIntakeExtras(deps.db, workspaceId);
  let claimed = false;
  if (!state) {
    claimed = await claimIntakeExtras(deps.db, workspaceId, claim);
  } else if (
    state.status === "pending" &&
    (state.claimedAt === null || now.getTime() - state.claimedAt.getTime() > EXTRAS_CLAIM_STALE_MS)
  ) {
    claimed = await takeOverIntakeExtras(deps.db, workspaceId, {
      ...claim,
      staleBefore: new Date(now.getTime() - EXTRAS_CLAIM_STALE_MS),
    });
  }
  if (claimed) {
    void deps.background.run(
      (signal) => askForExtras(deps, workspaceId, proposal, claim, log, signal),
      (error) => log.warn("intake.extras_failed", { workspaceId, error: errorName(error) }),
    );
    return { status: "pending", questions: [] };
  }
  state ??= await getIntakeExtras(deps.db, workspaceId);
  if (!state) return { status: "pending", questions: [] };
  return { status: state.status, questions: state.status === "done" ? state.questions : [] };
}

export function intakeRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), async (c) => {
      const workspaceId = c.get("workspaceId");
      if (!(await formIsOpen(deps, workspaceId))) return c.json(NOT_READY, 409);
      const proposal = await proposalOf(deps, workspaceId);
      const edits = await listIntakeAnswers(deps.db, workspaceId);
      const extras = await extrasFor(deps, workspaceId, proposal, c.get("log"));
      return c.json({ proposal, edits, extras } satisfies IntakeForm);
    })
    .put(
      "/answers/:key",
      requireRole("editor"),
      validParam(IntakeAnswerParamsSchema),
      validJson(IntakeAnswerInputSchema),
      async (c) => {
        const workspaceId = c.get("workspaceId");
        const { key } = c.req.valid("param");
        const parsed = profileValueSchema(key).safeParse(c.req.valid("json").value);
        if (!parsed.success) {
          const message = parsed.error.issues[0]?.message ?? "The answer is not valid";
          return c.json({ error: "invalid", message }, 400);
        }
        if (!(await formIsOpen(deps, workspaceId))) return c.json(NOT_READY, 409);
        if (await hasProfile(deps.db, workspaceId)) return c.json(CONFIRMED, 409);
        if (isExtraKey(key)) {
          const questions = await currentQuestions(deps, workspaceId);
          if (!questions.some((q) => `extra.${q.slug}` === key)) {
            return c.json(NO_SUCH_QUESTION, 404);
          }
        }
        const edit = await saveIntakeAnswer(deps.db, workspaceId, {
          key,
          value: parsed.data,
          source: "you",
          updatedBy: c.get("user").id,
          at: deps.clock.now(),
        });
        await deps.live.publish(workspaceId, { type: "intake.updated", data: {} });
        return c.json(edit satisfies IntakeEdit);
      },
    )
    .post("/confirm", requireRole("editor"), validJson(ConfirmIntakeInputSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      if (!(await formIsOpen(deps, workspaceId))) return c.json(NOT_READY, 409);
      if (await hasProfile(deps.db, workspaceId)) return c.json(CONFIRMED, 409);
      // Confirming now would save a profile without the extra questions, and they could never be
      // answered after: the profile takes no new keys.
      const extras = await getIntakeExtras(deps.db, workspaceId);
      if (extras?.status === "pending") return c.json(EXTRAS_PENDING, 409);
      const now = deps.clock.now();
      const entries = confirmedEntries({
        proposal: await proposalOf(deps, workspaceId),
        edits: await listIntakeAnswers(deps.db, workspaceId),
        questions: extras?.status === "done" ? extras.questions : [],
        at: now.toISOString(),
      });
      const created = await createConfirmedProfile(deps.db, workspaceId, {
        name: c.req.valid("json").name ?? DEFAULT_PROFILE_NAME,
        entries,
        createdBy: c.get("user").id,
        at: now,
      });
      if (!created.ok) return c.json(CONFIRMED, 409);
      c.get("log").info("intake.confirmed", { profileId: created.profile.id });
      await deps.live.publish(workspaceId, { type: "intake.updated", data: {} });
      // The backlog is matched once the profile exists (F1.6): until now only the sender checks
      // could run.
      await requestReevaluation(deps, workspaceId, { all: true }, "intake.confirmed");
      return c.json(created.profile satisfies Profile, 201);
    });
}
