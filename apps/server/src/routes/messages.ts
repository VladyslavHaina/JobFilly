import { correctCategory, getInboxMessage, getMessageRef, listInbox } from "@jobfilly/db";
import {
  CategoryCorrectionSchema,
  CvChoiceOverrideSchema,
  type MessageBody,
  type MessageDetail,
  type MessageList,
  MessageListQuerySchema,
  RoleParamsSchema,
} from "@jobfilly/schema";
import { type Context, Hono } from "hono";
import {
  NOT_FOUND,
  requireRole,
  validJson,
  validParam,
  validQuery,
  type WorkspaceEnv,
} from "../access";
import { setCvOverride } from "../cvs/override";
import type { AppDeps } from "../deps";
import { connectMailbox } from "../mailbox";
import { requestReevaluation } from "../profile/changes";

// The job inbox: list (with the Hidden filter, F3.4), detail, body on demand, category correction
// (F5), and an editor's CV choice for one role (F2.3, delegated to cvs/override.ts). A corrected
// category re-evaluates the message: the reply policy reads the category (reply_to), so a job
// alert corrected to recruiter outreach gets its draft, and mail corrected away loses it.
// :messageId is the URL-encoded RFC Message-ID (angle brackets included); Hono hands it over
// decoded, '/' and '%' included.
// Mounted once at /api/workspaces/:workspaceId/messages; each handler applies its own role.

const NO_MAILBOX = {
  error: "no_mailbox",
  message: "No mailbox is connected, so the message can't be read",
} as const;
const MAIL_UNREACHABLE = {
  error: "mail_unreachable",
  message: "Couldn't reach your mailbox. Try again in a moment.",
} as const;
const OWN_REPLY = {
  error: "own_reply",
  message: "Your own replies have no category to correct",
} as const;

const messageIdOf = (c: Context<WorkspaceEnv>) => c.req.param("messageId") ?? "";

export function messageRoutes(deps: AppDeps) {
  return (
    new Hono<WorkspaceEnv>()
      .get("/", requireRole("viewer"), validQuery(MessageListQuerySchema), async (c) => {
        const query = c.req.valid("query");
        const list = await listInbox(deps.db, c.get("workspaceId"), {
          category: query.category,
          q: query.q,
          showNonJob: query.showNonJob === "true",
          hidden: query.hidden === "true",
          page: query.page,
        });
        return c.json(list satisfies MessageList);
      })
      .get("/:messageId", requireRole("viewer"), async (c) => {
        const detail = await getInboxMessage(deps.db, c.get("workspaceId"), messageIdOf(c));
        if (!detail) return c.json(NOT_FOUND, 404);
        return c.json(detail satisfies MessageDetail);
      })
      // The body is fetched from the mailbox each time it is asked for and never stored (F4.9):
      // the folder, UIDVALIDITY and UID come from the stored message, the connection from the
      // workspace's mailbox. When the folder's UIDVALIDITY changed, the message is gone.
      .get("/:messageId/body", requireRole("viewer"), async (c) => {
        const workspaceId = c.get("workspaceId");
        const ref = await getMessageRef(deps.db, workspaceId, messageIdOf(c));
        if (!ref) return c.json(NOT_FOUND, 404);
        const client = await connectMailbox(deps, workspaceId);
        if (!client) return c.json(NO_MAILBOX, 409);
        let body: { text: string } | null;
        try {
          body = await client.fetchBody(ref);
        } catch {
          // The reason may name the server or the account; the answer stays plain.
          return c.json(MAIL_UNREACHABLE, 502);
        } finally {
          await client.close().catch(() => {});
        }
        return c.json((body ? { text: body.text } : { gone: true }) satisfies MessageBody);
      })
      .put(
        "/:messageId/category",
        requireRole("editor"),
        validJson(CategoryCorrectionSchema),
        async (c) => {
          const workspaceId = c.get("workspaceId");
          const messageId = messageIdOf(c);
          const result = await correctCategory(
            deps.db,
            workspaceId,
            messageId,
            c.req.valid("json").category,
          );
          if (result === "not_found") return c.json(NOT_FOUND, 404);
          if (result === "own_reply") return c.json(OWN_REPLY, 409);
          // Also tells open inboxes, with one messages.updated naming the message.
          await requestReevaluation(
            deps,
            workspaceId,
            { messageIds: [messageId] },
            "category.corrected",
          );
          const detail = await getInboxMessage(deps.db, workspaceId, messageId);
          if (!detail) return c.json(NOT_FOUND, 404);
          return c.json(detail satisfies MessageDetail);
        },
      )
      .put(
        "/:messageId/roles/:position/cv",
        requireRole("editor"),
        validParam(RoleParamsSchema),
        validJson(CvChoiceOverrideSchema),
        async (c) => {
          const workspaceId = c.get("workspaceId");
          const { position } = c.req.valid("param");
          const result = await setCvOverride(deps, workspaceId, {
            messageId: messageIdOf(c),
            position,
            cvId: c.req.valid("json").cvId,
            userId: c.get("user").id,
          });
          if (!result.ok) return c.json(NOT_FOUND, 404);
          return c.json(result.cvChoice);
        },
      )
  );
}
