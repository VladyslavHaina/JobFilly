import {
  createMailbox,
  deleteMailbox,
  getMailboxRemovalSummary,
  getMailboxSyncStatus,
  listMailboxes,
  type StoredMailbox,
} from "@jobfilly/db";
import { FAILURE_MESSAGES, MAIL_PRESETS } from "@jobfilly/mail";
import {
  type MailboxInput,
  MailboxInputSchema,
  type MailboxList,
  MailboxParamsSchema,
  type MailboxPublic,
  type MailboxRemovalSummary,
  type MailPresetList,
  type MailTestResult,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { seal } from "../secrets";

// The workspace's mailboxes (F2, MVP 3 F3.1): presets, test, connect, disconnect, and the
// continuous sync's status for everyone in the workspace (MVP 2 F1.4). From MVP 3 a workspace
// connects several, one per address; a Google mailbox is connected through routes/oauth.ts. The
// password is sealed before it is stored, never returned and never logged (F2.3); plain-text
// IMAP is refused unless JOBFILLY_ALLOW_INSECURE_MAIL=true (F2.4). Disconnecting (F7.4) says first
// what goes with the mailbox (GET /:mailboxId/removal), then deletes its credentials, its synced
// messages and everything tied to them. Connecting and disconnecting tell every open browser of
// the workspace (MVP 2 F1.4): workspace.updated for the mailboxes themselves and mailbox.updated
// for their sync status, so no one keeps showing a mailbox that is gone or a status of one that
// isn't there.

const INSECURE: MailTestResult = {
  ok: false,
  reason: "insecure_refused",
  message: FAILURE_MESSAGES.insecure_refused,
};

const EXISTS = {
  error: "exists",
  message: "This mailbox is already connected to the workspace.",
};

export function toPublic(m: StoredMailbox): MailboxPublic {
  return {
    id: m.mailboxId,
    address: m.address,
    host: m.host,
    port: m.port,
    tlsMode: m.tlsMode,
    username: m.username,
    sentFolderPath: m.sentFolderPath,
    status: m.status,
    auth: m.authKind,
  };
}

/** Tells the workspace's open browsers that its mailboxes and their status changed. */
export async function publishMailboxChange(deps: AppDeps, workspaceId: string) {
  await deps.live.publish(workspaceId, { type: "workspace.updated", data: {} });
  await deps.live.publish(workspaceId, { type: "mailbox.updated", data: {} });
}

export function mailboxRoutes(deps: AppDeps) {
  const allowInsecure = deps.config.allowInsecureMail;

  /** Connects with the form's values and tests; a refusal is logged with its reason only. */
  async function testConnection(input: MailboxInput, log: Logger): Promise<MailTestResult> {
    let result: MailTestResult;
    if (input.tlsMode === "none" && !allowInsecure) {
      result = INSECURE;
    } else {
      const { address, ...conn } = input;
      const client = deps.mail.connect(conn, { allowInsecure, address });
      try {
        result = await client.test();
      } finally {
        await client.close().catch(() => undefined);
      }
    }
    if (!result.ok) log.warn("mailbox.test_failed", { reason: result.reason });
    return result;
  }

  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), async (c) => {
      const workspaceId = c.get("workspaceId");
      const stored = await listMailboxes(deps.db, workspaceId);
      const list: MailboxList = {
        items: await Promise.all(
          stored.map(async (m) => ({
            ...toPublic(m),
            sync: await getMailboxSyncStatus(deps.db, workspaceId, m.mailboxId),
          })),
        ),
      };
      return c.json(list);
    })
    .get("/presets", requireRole("viewer"), (c) => {
      const list: MailPresetList = { items: [...MAIL_PRESETS] };
      return c.json(list);
    })
    .post("/test", requireRole("admin"), validJson(MailboxInputSchema), async (c) => {
      return c.json(await testConnection(c.req.valid("json"), c.get("log")));
    })
    .post("/", requireRole("admin"), validJson(MailboxInputSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const input = c.req.valid("json");
      // Saving tests again: only a mailbox that works is stored, with the Sent folder it found.
      const tested = await testConnection(input, c.get("log"));
      if (!tested.ok) {
        return c.json({ error: tested.reason, message: tested.message }, 400);
      }
      const stored = {
        address: input.address,
        host: input.host,
        port: input.port,
        tlsMode: input.tlsMode,
        username: input.username,
        secretCiphertext: seal(deps.config.secretKey, input.password),
        sentFolderPath: tested.sentPath,
      };
      const created = await createMailbox(deps.db, workspaceId, stored);
      if (!created.ok) return c.json(EXISTS, 409);
      c.get("log").info("mailbox.connected", { mailboxId: created.mailboxId });
      await publishMailboxChange(deps, workspaceId);
      const body: MailboxPublic = toPublic({
        ...stored,
        workspaceId,
        mailboxId: created.mailboxId,
        status: "connected",
        authKind: "password",
      });
      return c.json(body, 201);
    })
    .get(
      "/:mailboxId/removal",
      requireRole("admin"),
      validParam(MailboxParamsSchema),
      async (c) => {
        const summary = await getMailboxRemovalSummary(
          deps.db,
          c.get("workspaceId"),
          c.req.valid("param").mailboxId,
        );
        if (!summary) return c.json(NOT_FOUND, 404);
        return c.json(summary satisfies MailboxRemovalSummary);
      },
    )
    .delete("/:mailboxId", requireRole("admin"), validParam(MailboxParamsSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      const { mailboxId } = c.req.valid("param");
      const removed = await getMailboxRemovalSummary(deps.db, workspaceId, mailboxId);
      if (!removed || !(await deleteMailbox(deps.db, workspaceId, mailboxId))) {
        return c.json(NOT_FOUND, 404);
      }
      c.get("log").info("mailbox.disconnected", {
        mailboxId,
        messages: removed.messages,
        roles: removed.roles,
        drafts: removed.drafts,
        decisions: removed.decisions,
      });
      await publishMailboxChange(deps, workspaceId);
      // Its mail went with it: the inbox, the drafts and the decision inbox show it at once.
      if (removed.messages > 0) {
        for (const type of ["messages.updated", "drafts.updated", "decisions.updated"] as const) {
          await deps.live.publish(workspaceId, { type, data: {} });
        }
      }
      return c.body(null, 204);
    });
}
