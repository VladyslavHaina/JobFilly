import {
  createMailbox,
  deleteMailbox,
  getMailboxConnection,
  getMailboxSyncStatus,
  type StoredMailbox,
} from "@jobfilly/db";
import { FAILURE_MESSAGES, MAIL_PRESETS } from "@jobfilly/mail";
import {
  type MailboxInput,
  MailboxInputSchema,
  type MailboxList,
  MailboxParamsSchema,
  type MailboxPublic,
  type MailPresetList,
  type MailTestResult,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import type { Logger } from "../log";
import { seal } from "../secrets";

// The workspace's mailbox (F2): presets, test, connect, disconnect, and the continuous sync's
// status for everyone in the workspace (MVP 2 F1.4). One mailbox per workspace in MVP 1 (F2.5).
// The password is sealed before it is stored, never returned and never logged (F2.3); plain-text
// IMAP is refused unless JOBFILLY_ALLOW_INSECURE_MAIL=true (F2.4).

const INSECURE: MailTestResult = {
  ok: false,
  reason: "insecure_refused",
  message: FAILURE_MESSAGES.insecure_refused,
};

const EXISTS = {
  error: "exists",
  message: "This workspace already has a mailbox. Disconnect it first to connect another one.",
};

function toPublic(m: StoredMailbox): MailboxPublic {
  return {
    id: m.mailboxId,
    address: m.address,
    host: m.host,
    port: m.port,
    tlsMode: m.tlsMode,
    username: m.username,
    sentFolderPath: m.sentFolderPath,
    status: m.status,
  };
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
      const stored = await getMailboxConnection(deps.db, workspaceId);
      const list: MailboxList = {
        items: stored
          ? [
              {
                ...toPublic(stored),
                sync: await getMailboxSyncStatus(deps.db, workspaceId, stored.mailboxId),
              },
            ]
          : [],
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
      if (await getMailboxConnection(deps.db, workspaceId)) return c.json(EXISTS, 409);
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
      const body: MailboxPublic = toPublic({
        ...stored,
        mailboxId: created.mailboxId,
        status: "connected",
      });
      return c.json(body, 201);
    })
    .delete("/:mailboxId", requireRole("admin"), validParam(MailboxParamsSchema), async (c) => {
      const deleted = await deleteMailbox(
        deps.db,
        c.get("workspaceId"),
        c.req.valid("param").mailboxId,
      );
      return deleted ? c.body(null, 204) : c.json(NOT_FOUND, 404);
    });
}
