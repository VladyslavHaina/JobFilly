import { clearSenderMark, setSenderMark } from "@jobfilly/db";
import { type SenderMarkInput, SenderMarkInputSchema } from "@jobfilly/schema";
import { Hono } from "hono";
import { requireRole, validJson, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { requestReevaluation } from "../profile/changes";

// Sender marks (F5.4): an editor marks an address or a whole domain trusted or blocked, or clears
// the mark (null). Marks are keyed by the sender, so they survive syncs and re-evaluations, and
// the check names them. Changing one re-does that sender's checks and evaluations (a sender
// scope), so a newly blocked sender loses its automatic drafts and a trusted one is no longer held
// back by its verdict. Mounted once at /api/workspaces/:workspaceId/senders.

/** An address has an @, a domain doesn't; both have a dot after it. */
function validTarget(input: SenderMarkInput): boolean {
  const at = input.value.lastIndexOf("@");
  if (input.scope === "address") return at > 0 && input.value.slice(at + 1).includes(".");
  return at < 0 && input.value.includes(".");
}

export function sendersRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>().put(
    "/marks",
    requireRole("editor"),
    validJson(SenderMarkInputSchema),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const input = c.req.valid("json");
      if (!validTarget(input)) {
        const message =
          input.scope === "address" ? "Give an email address" : "Give a domain such as example.com";
        return c.json({ error: "invalid", message }, 400);
      }
      if (input.mark === null) {
        await clearSenderMark(deps.db, workspaceId, input);
      } else {
        await setSenderMark(deps.db, workspaceId, {
          scope: input.scope,
          value: input.value,
          mark: input.mark,
          userId: c.get("user").id,
          at: deps.clock.now(),
        });
      }
      await requestReevaluation(
        deps,
        workspaceId,
        input.scope === "address" ? { senderAddress: input.value } : { senderDomain: input.value },
        "sender.marked",
      );
      return c.json(input satisfies SenderMarkInput);
    },
  );
}
