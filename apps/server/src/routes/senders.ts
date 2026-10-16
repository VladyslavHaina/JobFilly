import { clearSenderMark, findMessageSenderMark, setSenderMark } from "@jobfilly/db";
import {
  type AppliedSenderMark,
  type SenderMarkInput,
  SenderMarkInputSchema,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { NOT_FOUND, requireRole, validJson, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { requestReevaluation } from "../profile/changes";

// Sender marks (F5.4): an editor marks an address or a whole domain trusted or blocked, or clears
// the mark (null). Marks are keyed by the sender, so they survive syncs and re-evaluations, and
// the check names them. Changing one re-does that sender's checks and evaluations (a sender
// scope), so a newly blocked sender loses its automatic drafts and a trusted one is no longer held
// back by its verdict. GET tells the mark that applies to a message's sender now, its address's
// own or its domain's, so the UI clears that one; clearing a mark that isn't there is a 404, never
// a quiet success. The GET is keyed by the message, not the address: request lines end up in
// proxy and ingress logs, and an email address is never logged. :messageId is the URL-encoded RFC
// Message-ID, as in the messages routes. Mounted once at /api/workspaces/:workspaceId/senders.

const NO_MARK = { error: "not_found", message: "There is no such mark to clear" } as const;

/** An address has an @, a domain doesn't; both have a dot after it. */
function validTarget(input: SenderMarkInput): boolean {
  const at = input.value.lastIndexOf("@");
  if (input.scope === "address") return at > 0 && input.value.slice(at + 1).includes(".");
  return at < 0 && input.value.includes(".");
}

export function sendersRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/messages/:messageId/mark", requireRole("viewer"), async (c) => {
      const messageId = c.req.param("messageId");
      const found = await findMessageSenderMark(deps.db, c.get("workspaceId"), messageId);
      if (!found) return c.json(NOT_FOUND, 404);
      return c.json(found satisfies AppliedSenderMark);
    })
    .put("/marks", requireRole("editor"), validJson(SenderMarkInputSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const input = c.req.valid("json");
      if (!validTarget(input)) {
        const message =
          input.scope === "address" ? "Give an email address" : "Give a domain such as example.com";
        return c.json({ error: "invalid", message }, 400);
      }
      if (input.mark === null) {
        if (!(await clearSenderMark(deps.db, workspaceId, input))) return c.json(NO_MARK, 404);
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
    });
}
