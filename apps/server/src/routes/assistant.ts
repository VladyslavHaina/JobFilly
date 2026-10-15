import { AssistantSendSchema, IdSchema, ProposalEditSchema } from "@jobfilly/schema";
import { Hono } from "hono";
import { z } from "zod";
import { requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import {
  applyProposal,
  assistantState,
  discardProposal,
  editProposal,
  sendMessage,
} from "../assistant/service";
import type { AppDeps } from "../deps";

// The assistant (F8): the user's thread, sending a message, editing a proposal before Apply,
// Apply and Discard. Viewers can chat but can't apply (F8.8): sending and discarding take a
// viewer, editing and applying an editor. Mounted once at /api/workspaces/:workspaceId/assistant.
// Each member sees and acts on their own thread only; another member's proposal is a 404.

const ProposalParamsSchema = z.object({ proposalId: IdSchema });

export function assistantRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), async (c) =>
      c.json(await assistantState(deps, c.get("workspaceId"), c.get("user"))),
    )
    .post("/", requireRole("viewer"), validJson(AssistantSendSchema), async (c) => {
      const result = await sendMessage(
        deps,
        c.get("workspaceId"),
        c.get("user"),
        c.req.valid("json"),
        c.get("log"),
      );
      return result.ok ? c.json(result.data) : c.json(result.body, result.status);
    })
    .patch(
      "/proposals/:proposalId",
      requireRole("editor"),
      validParam(ProposalParamsSchema),
      validJson(ProposalEditSchema),
      async (c) => {
        const result = await editProposal(
          deps,
          c.get("workspaceId"),
          c.get("user"),
          c.req.valid("param").proposalId,
          c.req.valid("json").changes,
        );
        return result.ok ? c.json(result.data) : c.json(result.body, result.status);
      },
    )
    .post(
      "/proposals/:proposalId/apply",
      requireRole("editor"),
      validParam(ProposalParamsSchema),
      async (c) => {
        const result = await applyProposal(
          deps,
          c.get("workspaceId"),
          c.get("user"),
          c.req.valid("param").proposalId,
          c.get("log"),
        );
        return result.ok ? c.json(result.data) : c.json(result.body, result.status);
      },
    )
    .post(
      "/proposals/:proposalId/discard",
      requireRole("viewer"),
      validParam(ProposalParamsSchema),
      async (c) => {
        const result = await discardProposal(
          deps,
          c.get("workspaceId"),
          c.get("user"),
          c.req.valid("param").proposalId,
          c.get("log"),
        );
        return result.ok ? c.json(result.data) : c.json(result.body, result.status);
      },
    );
}
