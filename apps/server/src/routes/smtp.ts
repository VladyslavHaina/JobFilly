import { Hono } from "hono";
import { requireRole, type WorkspaceEnv } from "../access";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// A mailbox's SMTP settings (MVP 3, F4): PUT /:mailboxId/smtp saves them
// (SmtpSettingsInputSchema, the password sealed), POST /:mailboxId/smtp/test is the Test button
// (SmtpTestResultSchema). Built by the send slice. Mounted at
// /api/workspaces/:workspaceId/mailboxes next to routes/mailboxes.ts.

export function smtpRoutes(_deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .put("/:mailboxId/smtp", requireRole("admin"), notImplemented)
    .post("/:mailboxId/smtp/test", requireRole("admin"), notImplemented);
}
