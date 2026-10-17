import { z } from "zod";
import { IsoDateTimeSchema } from "./common";
import {
  AddressSchema,
  MailTestFailureReasonSchema,
  SmtpSettingsPublicSchema,
  TlsModeSchema,
} from "./mailbox";

// Sending with confirmation (MVP 3, F4). One message per action, never in bulk: Send shows the
// exact message with a confirmation token bound to the draft's content; confirming schedules it
// SEND_DELAY_SECONDS ahead with Undo; a draft changed after confirming needs a new confirmation.

/** How long a confirmed message waits, with Undo, before anything leaves (F4.2). */
export const SEND_DELAY_SECONDS = 10;

/** How long a confirmation token is good for after the confirmation was shown. */
export const SEND_TOKEN_TTL_MINUTES = 15;

/** A DNS name: labels of letters, digits and inner hyphens, joined by dots. */
const HOST_NAME =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
/** An IPv6 literal in brackets. */
const IPV6_LITERAL = /^\[[0-9A-Fa-f:.]+\]$/;

/**
 * An SMTP server's host name or IP address and nothing else: no scheme, user, path, port or
 * space, so no URL trick can point the connection at anything but the host shown. Any host is
 * allowed (self-hosted servers, as for IMAP).
 */
export const MailHostSchema = z
  .string()
  .trim()
  .min(1, "Enter the server name")
  .max(253)
  .refine((v) => HOST_NAME.test(v) || IPV6_LITERAL.test(v), {
    message: "Enter only the server name, like smtp.example.com",
  });

/** Any TCP port, as for IMAP. */
const MailPortSchema = z.number().int().min(1).max(65535);

/**
 * PUT /mailboxes/:mailboxId/smtp: a mailbox's SMTP settings (the preset fills them). `password`
 * is write-only; leaving it out keeps the stored one, but only for the same host: a stored
 * password never goes to a host other than the one it was given for, so the first settings and
 * any change of host need it. A Google mailbox has nothing to set: it sends with its OAuth token
 * through the server's Google SMTP host (JOBFILLY_GOOGLE_SMTP_HOST), never one typed here.
 */
export const SmtpSettingsInputSchema = z.object({
  host: MailHostSchema,
  port: MailPortSchema,
  tlsMode: TlsModeSchema,
  username: z.string().min(1, "Enter the user name"),
  password: z.string().min(1).optional(),
});
export type SmtpSettingsInput = z.infer<typeof SmtpSettingsInputSchema>;

/** POST /mailboxes/:mailboxId/smtp/test: the Test button. `message` never holds a secret. */
export const SmtpTestResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: MailTestFailureReasonSchema, message: z.string() }),
]);
export type SmtpTestResult = z.infer<typeof SmtpTestResultSchema>;

/** What packages/mail signs in to SMTP with: a password or an OAuth access token (XOAUTH2). */
export const SmtpLoginSchema = z.union([
  z.object({
    host: MailHostSchema,
    port: MailPortSchema,
    tlsMode: TlsModeSchema,
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  z.object({
    host: MailHostSchema,
    port: MailPortSchema,
    tlsMode: TlsModeSchema,
    username: z.string().min(1),
    accessToken: z.string().min(1),
  }),
]);
export type SmtpLogin = z.infer<typeof SmtpLoginSchema>;

/** The SMTP envelope of one outgoing message: the sender and every recipient's address. */
export const SmtpEnvelopeSchema = z.object({
  from: z.string().min(1),
  to: z.array(z.string().min(1)).min(1),
});
export type SmtpEnvelope = z.infer<typeof SmtpEnvelopeSchema>;

/**
 * One outgoing message as it will leave (packages/mail builds it, then reads these back from its
 * bytes): the recipients, subject, attachments and the exact text, the quote of the original
 * included. The confirmation shows exactly this (F4.1).
 */
export const OutgoingPreviewSchema = z.object({
  from: AddressSchema,
  to: z.array(AddressSchema),
  cc: z.array(AddressSchema),
  subject: z.string(),
  text: z.string(),
  attachments: z.array(z.object({ fileName: z.string(), sizeBytes: z.number().int() })),
});
export type OutgoingPreview = z.infer<typeof OutgoingPreviewSchema>;

/**
 * GET /drafts/:draftId/send: the confirmation (F4.1) — recipients, subject, attachments and the
 * exact text — and the token that confirms exactly this content.
 */
export const SendPreviewSchema = OutgoingPreviewSchema.extend({
  draftId: z.uuid(),
  mailboxId: z.uuid(),
  token: z.string().min(1),
  expiresAt: IsoDateTimeSchema,
});
export type SendPreview = z.infer<typeof SendPreviewSchema>;

/** POST /drafts/:draftId/send: confirm with the preview's token. */
export const SendConfirmSchema = z.object({ token: z.string().min(1) });
export type SendConfirm = z.infer<typeof SendConfirmSchema>;

/**
 * scheduled (waiting out the delay, Undo possible), cancelled (Undo: nothing was sent), sending,
 * sent, failed (why in failureReason; nothing left, or the server says what it accepted).
 */
export const SendStatusSchema = z.enum(["scheduled", "cancelled", "sending", "sent", "failed"]);
export type SendStatus = z.infer<typeof SendStatusSchema>;

/** One send as the API shows it; DELETE /drafts/:draftId/send is Undo while it is scheduled. */
export const SendSchema = z.object({
  id: z.uuid(),
  draftId: z.uuid(),
  status: SendStatusSchema,
  sendAt: IsoDateTimeSchema,
  sentAt: IsoDateTimeSchema.nullable(),
  failureReason: z.string().nullable(),
});
export type Send = z.infer<typeof SendSchema>;

/**
 * GET /mailboxes/:mailboxId/smtp: Settings › Sending's current values for one mailbox, null until
 * set (never a password). `savesSentCopy` says the provider files sent mail in Sent itself, so the
 * app doesn't append a copy (F4.4).
 */
export const SmtpSettingsViewSchema = z.object({
  smtp: SmtpSettingsPublicSchema.nullable(),
  savesSentCopy: z.boolean(),
});
export type SmtpSettingsView = z.infer<typeof SmtpSettingsViewSchema>;
