import { getMailboxConnection, getMailboxSmtp, saveMailboxSmtp } from "@jobfilly/db";
import { SmtpError } from "@jobfilly/mail";
import {
  MailboxParamsSchema,
  type SmtpLogin,
  type SmtpSettingsInput,
  SmtpSettingsInputSchema,
  type SmtpSettingsView,
  type SmtpTestResult,
} from "@jobfilly/schema";
import { Hono } from "hono";
import {
  NOT_FOUND,
  requireFullAccess,
  requireRole,
  validJson,
  validParam,
  type WorkspaceEnv,
} from "../access";
import type { AppDeps } from "../deps";
import { open, seal } from "../secrets";
import { googleSmtp, providerSavesSentCopy } from "../send/outgoing";

// A mailbox's SMTP settings (MVP 3, F4): GET /:mailboxId/smtp reads them (never a password),
// PUT /:mailboxId/smtp saves them (SmtpSettingsInputSchema, the password sealed), POST
// /:mailboxId/smtp/test is the Test button (SmtpTestResultSchema). Mounted at
// /api/workspaces/:workspaceId/mailboxes next to routes/mailboxes.ts; no mail content, so the read
// is open to a member who sees the pipeline only, but saving and testing need full access: they
// decide where the workspace's mail goes.
//
// The same policy as the IMAP settings: any host name or IP address (self-hosted servers), no
// URL, plain text refused unless JOBFILLY_ALLOW_INSECURE_MAIL, and fixed words for every failure.
// A stored password is used only with the host it was given for, so changing the host takes the
// password again and no admin can send a stored password elsewhere. A Google mailbox has nothing
// to set: it sends through the server's Google settings (JOBFILLY_GOOGLE_SMTP_HOST).

const GOOGLE = {
  error: "google",
  message: "A Google mailbox sends through Google with its sign-in. There is nothing to set.",
};
const NEEDS_PASSWORD = {
  error: "password_needed",
  message: "Enter the SMTP password for this server.",
};
const INSECURE = new SmtpError("insecure_refused");

export function smtpRoutes(deps: AppDeps) {
  const allowInsecure = deps.config.allowInsecureMail;

  /** The mailbox, its stored SMTP settings, and the sealed password the form's values may use. */
  async function load(ws: string, mailboxId: string) {
    const mailbox = await getMailboxConnection(deps.db, ws, mailboxId);
    if (!mailbox) return null;
    const stored = await getMailboxSmtp(deps.db, ws, mailbox.mailboxId);
    return { mailbox, stored };
  }

  /** The stored password, only when the form keeps the host it was given for. */
  const keptSecret = (
    stored: Awaited<ReturnType<typeof getMailboxSmtp>>,
    input: SmtpSettingsInput,
  ): string | null =>
    stored?.secretCiphertext && stored.host.toLowerCase() === input.host.toLowerCase()
      ? stored.secretCiphertext
      : null;

  return new Hono<WorkspaceEnv>()
    .get("/:mailboxId/smtp", requireRole("viewer"), validParam(MailboxParamsSchema), async (c) => {
      const found = await load(c.get("workspaceId"), c.req.valid("param").mailboxId);
      if (!found) return c.json(NOT_FOUND, 404);
      const smtp =
        found.mailbox.authKind === "google" ? googleSmtp(deps, found.mailbox) : found.stored;
      const view: SmtpSettingsView = {
        smtp: smtp
          ? { host: smtp.host, port: smtp.port, tlsMode: smtp.tlsMode, username: smtp.username }
          : null,
        savesSentCopy: smtp ? providerSavesSentCopy({ mailbox: found.mailbox, smtp }) : false,
      };
      return c.json(view);
    })
    .put(
      "/:mailboxId/smtp",
      requireRole("admin"),
      requireFullAccess(),
      validParam(MailboxParamsSchema),
      validJson(SmtpSettingsInputSchema),
      async (c) => {
        const ws = c.get("workspaceId");
        const input = c.req.valid("json");
        const found = await load(ws, c.req.valid("param").mailboxId);
        if (!found) return c.json(NOT_FOUND, 404);
        if (found.mailbox.authKind === "google") return c.json(GOOGLE, 409);
        if (input.tlsMode === "none" && !allowInsecure) {
          return c.json({ error: "insecure_refused", message: INSECURE.message }, 400);
        }
        const secretCiphertext = input.password
          ? seal(deps.config.secretKey, input.password)
          : keptSecret(found.stored, input);
        if (!secretCiphertext) return c.json(NEEDS_PASSWORD, 400);
        const { password: _password, ...settings } = input;
        await saveMailboxSmtp(deps.db, ws, found.mailbox.mailboxId, {
          ...settings,
          secretCiphertext,
          now: deps.clock.now(),
        });
        await deps.live.publish(ws, { type: "mailbox.updated", data: {} });
        const smtp = { ...settings, secretCiphertext };
        const view: SmtpSettingsView = {
          smtp: settings,
          savesSentCopy: providerSavesSentCopy({ mailbox: found.mailbox, smtp }),
        };
        return c.json(view);
      },
    )
    .post(
      "/:mailboxId/smtp/test",
      requireRole("admin"),
      requireFullAccess(),
      validParam(MailboxParamsSchema),
      validJson(SmtpSettingsInputSchema),
      async (c) => {
        const ws = c.get("workspaceId");
        const input = c.req.valid("json");
        const found = await load(ws, c.req.valid("param").mailboxId);
        if (!found) return c.json(NOT_FOUND, 404);
        if (found.mailbox.authKind === "google") return c.json(GOOGLE, 409);
        const sealed = input.password ? null : keptSecret(found.stored, input);
        if (!input.password && !sealed) return c.json(NEEDS_PASSWORD, 400);
        let result: SmtpTestResult;
        if (input.tlsMode === "none" && !allowInsecure) {
          result = { ok: false, reason: "insecure_refused", message: INSECURE.message };
        } else {
          const login: SmtpLogin = {
            host: input.host,
            port: input.port,
            tlsMode: input.tlsMode,
            username: input.username,
            password: input.password ?? open(deps.config.secretKey, sealed ?? ""),
          };
          result = await deps.smtp.test(login, { allowInsecure });
        }
        if (!result.ok) {
          deps.log
            .child({ workspaceId: ws })
            .warn("mailbox.test_failed", { protocol: "smtp", reason: result.reason });
        }
        return c.json(result);
      },
    );
}
