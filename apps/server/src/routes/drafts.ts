import { getDraft, listDrafts, loadMessageInputs, publicDraft } from "@jobfilly/db";
import {
  type Draft,
  DraftCreateSchema,
  type DraftList,
  DraftUpdateSchema,
  IdSchema,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { z } from "zod";
import {
  NOT_FOUND,
  requireRole,
  validJson,
  validParam,
  validQuery,
  type WorkspaceEnv,
} from "../access";
import type { AppDeps } from "../deps";
import { type DraftChange, discardDraft, editDraft } from "../drafts/edit";
import { requestDraft } from "../drafts/request";

// Drafts (F6): list, Draft a reply for a role, read, edit (replaces the mailbox copy), discard
// (deletes it from the mailbox). Viewers read, editors change (F6.7). Mounted once at
// /api/workspaces/:workspaceId/drafts. Draft a reply works on any role, whatever its score
// (F6.5), takes back a failed draft's row, and makes a new draft after a discard; the reply is
// written by draft.create, so it answers 202 with the draft in status saving.

const DraftParamsSchema = z.object({ draftId: IdSchema });
const DraftQuerySchema = z.object({ messageId: z.string().min(1).optional() });

const STATUS = { not_found: 404, conflict: 409, mailbox: 503 } as const;

/** A change's answer: the draft, or why not with its status. */
function answer(result: DraftChange) {
  if (result.ok) return { body: publicDraft(result.draft) satisfies Draft, status: 200 as const };
  return { body: { error: result.error, message: result.message }, status: STATUS[result.error] };
}

export function draftsRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), validQuery(DraftQuerySchema), async (c) => {
      const drafts = await listDrafts(deps.db, c.get("workspaceId"), c.req.valid("query"));
      return c.json({ items: drafts.map(publicDraft) } satisfies DraftList);
    })
    .post("/", requireRole("editor"), validJson(DraftCreateSchema), async (c) => {
      const ws = c.get("workspaceId");
      const role = c.req.valid("json");
      const [message] = await loadMessageInputs(deps.db, ws, [role.messageId]);
      if (!message?.facts[role.position]) return c.json(NOT_FOUND, 404);
      const claim = await requestDraft(deps, ws, role, {
        origin: "on_demand",
        userId: c.get("user").id,
      });
      if (!claim) {
        return c.json({ error: "conflict", message: "This role already has a draft" }, 409);
      }
      const draft = await getDraft(deps.db, ws, claim.id);
      if (!draft) return c.json(NOT_FOUND, 404);
      return c.json(publicDraft(draft) satisfies Draft, 202);
    })
    .get("/:draftId", requireRole("viewer"), validParam(DraftParamsSchema), async (c) => {
      const draft = await getDraft(deps.db, c.get("workspaceId"), c.req.valid("param").draftId);
      if (!draft) return c.json(NOT_FOUND, 404);
      return c.json(publicDraft(draft) satisfies Draft);
    })
    .patch(
      "/:draftId",
      requireRole("editor"),
      validParam(DraftParamsSchema),
      validJson(DraftUpdateSchema),
      async (c) => {
        const ws = c.get("workspaceId");
        const result = await editDraft(
          deps,
          ws,
          c.req.valid("param").draftId,
          c.req.valid("json"),
          deps.log.child({ workspaceId: ws, userId: c.get("user").id }),
        );
        const { body, status } = answer(result);
        return c.json(body, status);
      },
    )
    .post("/:draftId/discard", requireRole("editor"), validParam(DraftParamsSchema), async (c) => {
      const ws = c.get("workspaceId");
      const result = await discardDraft(
        deps,
        ws,
        c.req.valid("param").draftId,
        deps.log.child({ workspaceId: ws, userId: c.get("user").id }),
      );
      const { body, status } = answer(result);
      return c.json(body, status);
    });
}
