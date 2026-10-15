import { buildIntakeExtraInput, confirmedEntries, extraEvidenceIds } from "@jobfilly/core";
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
  recordAiUsage,
  saveIntakeAnswer,
  takeOverIntakeExtras,
} from "@jobfilly/db";
import {
  ConfirmIntakeInputSchema,
  DEFAULT_PROFILE_NAME,
  type ExtraQuestion,
  IntakeAnswerInputSchema,
  type IntakeEdit,
  type IntakeForm,
  type IntakeProposal,
  isExtraKey,
  MAX_EXTRA_QUESTIONS,
  type Profile,
  ProfileKeySchema,
  profileValueSchema,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { z } from "zod";
import { requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import { MINUTE } from "../clock";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { open } from "../secrets";

// The intake form: proposals, answers, confirm (F6).
// Mounted once at /api/workspaces/:workspaceId/intake; each handler applies its own role.
//
// The form opens once the first scan has stopped. Its core answers are aggregated afresh from
// what the scan stored each time (packages/core), the user's click edits are kept apart in
// intake_answers, and Confirm saves both as the workspace's profile. Later runs ("Analyze them")
// keep filling the proposal but never touch a confirmed profile: it is a separate row.
//
// The extra questions come from one intake.v1 call per workspace (TBD-19): whoever opens the form
// first claims it through the intake_extras row and makes the call in the background; everyone
// else sees 'pending' until an intake.updated event says it is done. A claim still pending after
// 2 minutes (its replica died) can be taken over by one caller.

const NOT_READY = {
  error: "not_ready",
  message: "The intake form is ready once the first scan has stopped",
} as const;
const CONFIRMED = {
  error: "confirmed",
  message: "Your profile is already confirmed. Change it on the profile page.",
} as const;
const NO_SUCH_QUESTION = { error: "not_found", message: "There is no such question" } as const;

/** A pending claim older than this belongs to a replica that is gone. */
const EXTRAS_CLAIM_STALE_MS = 2 * MINUTE;

const AnswerParamsSchema = z.object({ key: ProfileKeySchema });

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

/**
 * Makes the one intake.v1 call for a claim and stores its outcome. Runs after the response: it
 * never holds a request or a transaction open while the model answers.
 */
async function askForExtras(
  deps: AppDeps,
  workspaceId: string,
  proposal: IntakeProposal,
  claim: { instance: string; at: Date },
): Promise<void> {
  let status: "done" | "failed" = "failed";
  let questions: ExtraQuestion[] = [];
  const settings = await getAiSettings(deps.db, workspaceId);
  if (settings) {
    try {
      const messages = await getStoredMessages(deps.db, workspaceId, extraEvidenceIds(proposal));
      const client = deps.ai.client({
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        models: settings.models,
        apiKey: settings.keyCiphertext ? open(deps.config.secretKey, settings.keyCiphertext) : null,
      });
      const result = await client.intake(buildIntakeExtraInput(proposal, messages));
      for (const usage of result.usage) {
        await recordAiUsage(deps.db, workspaceId, {
          scanId: null,
          task: usage.task,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
      }
      if (result.ok) {
        status = "done";
        questions = result.data.questions.slice(0, MAX_EXTRA_QUESTIONS);
      }
    } catch {
      // The provider or the client failed: the form goes on without extra questions.
    }
  }
  await finishIntakeExtras(deps.db, workspaceId, {
    claim,
    status,
    questions,
    at: deps.clock.now(),
  });
  await deps.live.publish(workspaceId, { type: "intake.updated", data: {} });
}

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
    askForExtras(deps, workspaceId, proposal, claim).catch((error) =>
      log.error("http.error", { error }),
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
      validParam(AnswerParamsSchema),
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
      const now = deps.clock.now();
      const entries = confirmedEntries({
        proposal: await proposalOf(deps, workspaceId),
        edits: await listIntakeAnswers(deps.db, workspaceId),
        questions: await currentQuestions(deps, workspaceId),
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
      return c.json(created.profile satisfies Profile, 201);
    });
}
