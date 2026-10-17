import { IdSchema, type Send, SendConfirmSchema, type SendPreview } from "@jobfilly/schema";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import {
  confirmSend,
  previewSend,
  type SendError,
  type SendOutcome,
  undoSend,
} from "../send/confirm";

// Sending one draft (MVP 3, F4): GET /:draftId/send is the confirmation with its token
// (SendPreviewSchema), POST confirms it (SendConfirmSchema) and schedules the send
// SEND_DELAY_SECONDS ahead, DELETE is Undo while it waits. One draft per request; no route takes
// several (no bulk send, F4.3). Viewers can't send (F4.5). Mounted at
// /api/workspaces/:workspaceId/drafts, closed to a member who sees the pipeline only.

const DraftParamsSchema = z.object({ draftId: IdSchema });

const STATUS: Record<SendError, 400 | 403 | 404 | 409 | 503> = {
  not_found: 404,
  not_sendable: 409,
  no_smtp: 409,
  invalid_token: 403,
  confirm_again: 409,
  already_sending: 409,
  nothing_to_undo: 409,
  mailbox: 503,
};

function answer<T extends SendPreview | Send>(c: Context, result: SendOutcome<T>, ok: 200 | 202) {
  if (result.ok) return c.json(result.value, ok);
  return c.json({ error: result.error, message: result.message }, STATUS[result.error]);
}

export function sendRoutes(deps: AppDeps) {
  const subject = (c: Context<WorkspaceEnv>, draftId: string) => ({
    workspaceId: c.get("workspaceId"),
    draftId,
    userId: c.get("user").id,
  });
  const log = (c: Context<WorkspaceEnv>) =>
    deps.log.child({ workspaceId: c.get("workspaceId"), userId: c.get("user").id });
  return new Hono<WorkspaceEnv>()
    .get("/:draftId/send", requireRole("editor"), validParam(DraftParamsSchema), async (c) =>
      answer(c, await previewSend(deps, subject(c, c.req.valid("param").draftId)), 200),
    )
    .post(
      "/:draftId/send",
      requireRole("editor"),
      validParam(DraftParamsSchema),
      validJson(SendConfirmSchema),
      async (c) => {
        const who = subject(c, c.req.valid("param").draftId);
        return answer(c, await confirmSend(deps, who, c.req.valid("json").token, log(c)), 202);
      },
    )
    .delete("/:draftId/send", requireRole("editor"), validParam(DraftParamsSchema), async (c) =>
      answer(c, await undoSend(deps, subject(c, c.req.valid("param").draftId), log(c)), 200),
    );
}
