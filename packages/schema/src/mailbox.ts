import { z } from "zod";
import { IdSchema, IsoDateTimeSchema } from "./common";
import { MailboxSyncStatusSchema, NEVER_SYNCED } from "./sync";

export const TlsModeSchema = z.enum(["tls", "starttls", "none"]);
export type TlsMode = z.infer<typeof TlsModeSchema>;

/** A DNS name: labels of letters, digits and inner hyphens, joined by dots. */
const HOST_NAME =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
/** An IPv6 literal in brackets. */
const IPV6_LITERAL = /^\[[0-9A-Fa-f:.]+\]$/;

/**
 * A mail server's host name or IP address and nothing else, the same rule for IMAP and SMTP (MVP 3,
 * F4): no scheme, user, path, port or space, so no URL trick can point the connection at anything
 * but the host shown. Any host is allowed (self-hosted servers).
 */
export const MailHostSchema = z
  .string()
  .trim()
  .min(1, "Enter the server name")
  .max(253)
  .refine((v) => HOST_NAME.test(v) || IPV6_LITERAL.test(v), {
    message: "Enter only the server name, like mail.example.com",
  });

/** What packages/mail needs to reach an IMAP server. The password never leaves the server. */
export const MailConnectionSchema = z.object({
  host: MailHostSchema,
  port: z.number().int().min(1).max(65535),
  tlsMode: TlsModeSchema,
  username: z.string().min(1, "Enter the user name"),
  password: z.string().min(1, "Enter the password"),
});
export type MailConnection = z.infer<typeof MailConnectionSchema>;

export const MailPresetIdSchema = z.enum([
  "gmail",
  "icloud",
  "yahoo",
  "fastmail",
  "gmx",
  "webde",
  "other",
]);
export type MailPresetId = z.infer<typeof MailPresetIdSchema>;

/**
 * A provider's SMTP server (MVP 3, F4): the preset fills it on Settings › Sending.
 * `savesSentCopy` is true when the provider files every message sent through it in the Sent
 * folder itself, so the app must not append a second copy (F4.4).
 */
export const SmtpPresetSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  tlsMode: TlsModeSchema,
  savesSentCopy: z.boolean(),
});
export type SmtpPreset = z.infer<typeof SmtpPresetSchema>;

/**
 * A provider preset: it fills host, port and TLS; "other" leaves them to the user. From MVP 3 it
 * also names the provider's SMTP server (null for "other").
 */
export const MailPresetSchema = z.object({
  id: MailPresetIdSchema,
  label: z.string(),
  host: z.string(),
  port: z.number().int(),
  tlsMode: TlsModeSchema,
  needsAppPassword: z.boolean(),
  helpUrl: z.url().nullable(),
  smtp: SmtpPresetSchema.nullable(),
});
export type MailPreset = z.infer<typeof MailPresetSchema>;

export const MailPresetListSchema = z.object({ items: z.array(MailPresetSchema) });
export type MailPresetList = z.infer<typeof MailPresetListSchema>;

export const MailTestFailureReasonSchema = z.enum([
  "wrong_password",
  "unreachable",
  "tls",
  "insecure_refused",
]);
export type MailTestFailureReason = z.infer<typeof MailTestFailureReasonSchema>;

/**
 * The outcome of a connection test. On success `folders` lists the folder paths found and
 * `sentPath` is the folder the server marks as Sent (special use \Sent, else a folder named like
 * Sent), or null when there is none. `message` is plain words and never contains the password.
 */
export const MailTestResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), folders: z.array(z.string()), sentPath: z.string().nullable() }),
  z.object({ ok: z.literal(false), reason: MailTestFailureReasonSchema, message: z.string() }),
]);
export type MailTestResult = z.infer<typeof MailTestResultSchema>;

/** Test and connect take the address plus the connection; the password is write-only. */
export const MailboxInputSchema = MailConnectionSchema.extend({
  address: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ message: "Enter a valid email address" })),
});
export type MailboxInput = z.infer<typeof MailboxInputSchema>;

/**
 * connected, failing (the sync's state says why), or (MVP 3, F3.2) reconnect_needed: the provider
 * refused the mailbox's OAuth token, so the user signs in again; nothing stored is lost meanwhile.
 */
export const MailboxStatusSchema = z.enum(["connected", "failing", "reconnect_needed"]);
export type MailboxStatus = z.infer<typeof MailboxStatusSchema>;

/**
 * How a mailbox signs in (MVP 3, F3): a password (an app password where the provider offers one)
 * or Google's OAuth, the only OAuth provider (TBD-441). IMAP and SMTP both use it.
 */
export const MailboxAuthSchema = z.enum(["password", "google"]);
export type MailboxAuth = z.infer<typeof MailboxAuthSchema>;

/** A mailbox's SMTP settings as the API returns them (F4): never a password. */
export const SmtpSettingsPublicSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  tlsMode: TlsModeSchema,
  username: z.string(),
});
export type SmtpSettingsPublic = z.infer<typeof SmtpSettingsPublicSchema>;

/** A mailbox as the API returns it: never a password or any other secret. */
export const MailboxPublicSchema = z.object({
  id: z.uuid(),
  address: z.string(),
  host: z.string(),
  port: z.number().int(),
  tlsMode: TlsModeSchema,
  username: z.string(),
  sentFolderPath: z.string().nullable(),
  status: MailboxStatusSchema,
  /** The continuous sync's status (F1.4); "never" until the first sync. */
  sync: MailboxSyncStatusSchema.default(NEVER_SYNCED),
  /** MVP 3: how it signs in; absent (a previous replica) reads as password. */
  auth: MailboxAuthSchema.optional(),
  /** MVP 3 (F4.1): its SMTP settings, null until set; only then can its drafts be sent. */
  smtp: SmtpSettingsPublicSchema.nullable().optional(),
});
/** As the server writes it: `sync` may be left out before the first sync. */
export type MailboxPublic = z.input<typeof MailboxPublicSchema>;

/** GET /mailboxes: the workspace's mailboxes (one at most before MVP 3), oldest first. */
export const MailboxListSchema = z.object({ items: z.array(MailboxPublicSchema) });
export type MailboxList = z.input<typeof MailboxListSchema>;

/** The path of /mailboxes/:mailboxId, for disconnecting. */
export const MailboxParamsSchema = z.object({ mailboxId: IdSchema });
export type MailboxParams = z.infer<typeof MailboxParamsSchema>;

export const AddressSchema = z.object({ address: z.string(), name: z.string().nullable() });
export type Address = z.infer<typeof AddressSchema>;

export const MailFolderSchema = z.enum(["inbox", "sent"]);
export type MailFolder = z.infer<typeof MailFolderSchema>;

/** At most this many characters from the start of the plain text are kept as the snippet. */
export const SNIPPET_MAX_LENGTH = 200;

/**
 * The headers of one message, as packages/mail reads them. `messageId` is the RFC Message-ID,
 * verbatim from the header with its angle brackets, or a stable synthetic
 * "<folder.digest@jobfilly.invalid>" when the header is missing (syntheticMessageId). Everywhere
 * outside the database primary key a message is named by this string.
 */
export const EnvelopeSchema = z.object({
  messageId: z.string().min(1),
  folder: MailFolderSchema,
  folderPath: z.string(),
  uidValidity: z.number().int().nonnegative(),
  uid: z.number().int().nonnegative(),
  date: IsoDateTimeSchema,
  from: AddressSchema,
  to: z.array(AddressSchema),
  cc: z.array(AddressSchema),
  replyTo: z.array(AddressSchema),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  subject: z.string(),
  listId: z.string().nullable(),
  listUnsubscribe: z.string().nullable(),
  precedence: z.string().nullable(),
  autoSubmitted: z.string().nullable(),
  snippet: z.string().max(SNIPPET_MAX_LENGTH),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** Where one message lives in the mailbox, to fetch its body on demand (packages/mail). */
export const MessageRefSchema = EnvelopeSchema.pick({
  folderPath: true,
  uidValidity: true,
  uid: true,
});
export type MessageRef = z.infer<typeof MessageRefSchema>;

/**
 * The msg-id shape (RFC 5322, with the UTF-8 of RFC 6532): one "<...>" with no whitespace, no
 * angle bracket and no control, format (zero-width, bidi) or separator character inside. Only a
 * Message-ID of this shape is kept from a header (packages/mail uses the synthetic one otherwise),
 * so an id can never carry words or a line break into a prompt's structure lines (F3.5).
 */
const MSG_ID = /^<[^<>\s\p{C}\p{Z}]+>$/u;

export function isMsgId(value: string): boolean {
  return MSG_ID.test(value);
}

/** A synthetic Message-ID's digest: 32 lower-case hex digits (128 bits of a SHA-256). */
const DIGEST = /^[0-9a-f]{32}$/;

/**
 * The synthetic Message-ID of a message whose header is missing or not of the msg-id shape:
 * "<inbox.<digest>@jobfilly.invalid>". The digest is of what the message says, never of where it
 * is (packages/mail hashes its From, Date, Subject and the start of its text), so the message
 * keeps its id when its folder is rebuilt under a new UIDVALIDITY and is matched again (F1.3).
 */
export function syntheticMessageId(folder: MailFolder, digest: string): string {
  if (!DIGEST.test(digest)) throw new Error("syntheticMessageId: the digest is 32 hex digits");
  return `<${folder}.${digest}@jobfilly.invalid>`;
}

/**
 * Both shapes a synthetic Message-ID has had: the digest one, and the one MVP 1 built from the
 * folder's UIDVALIDITY and the UID ("<inbox.7.12@jobfilly.invalid>"), which rows stored before
 * still carry.
 */
const SYNTHETIC_MESSAGE_ID = /^<(inbox|sent)\.(\d+\.\d+|[0-9a-f]{32})@jobfilly\.invalid>$/;

/**
 * Whether a Message-ID is one syntheticMessageId made up (now or before): no message in any
 * mailbox has it, so a reply has nothing to thread to.
 */
export function isSyntheticMessageId(messageId: string): boolean {
  return SYNTHETIC_MESSAGE_ID.test(messageId);
}

// --- MVP 2: continuous sync and drafts in the mailbox (packages/mail's MailClient) -------------

/**
 * One message as fetchSince reads it: its envelope and when it arrived in the folder, the
 * server's INTERNALDATE (the envelope's date when the server tells none). The sync judges how
 * old mail is by its arrival, never by the Date header the sender wrote.
 */
export const SyncedEnvelopeSchema = EnvelopeSchema.extend({ receivedAt: IsoDateTimeSchema });
export type SyncedEnvelope = z.infer<typeof SyncedEnvelopeSchema>;

/**
 * fetchSince's answer: the folder's UIDVALIDITY now and the envelopes of every message after
 * `afterUid`. `changed` is true when the UIDVALIDITY differs from the one asked with: the folder
 * was rebuilt, its UIDs mean other messages, and `messages` then holds every message of the
 * folder, so the caller re-indexes them by Message-ID (F1.3).
 */
export const FetchSinceResultSchema = z.object({
  uidValidity: z.number().int().nonnegative(),
  changed: z.boolean(),
  messages: z.array(SyncedEnvelopeSchema),
});
export type FetchSinceResult = z.infer<typeof FetchSinceResultSchema>;

/**
 * What a reply is threaded to (In-Reply-To, References) and quotes, read from the mailbox when
 * the draft is made (fetchOriginal): never stored, as no mail body is.
 */
export const OriginalMessageSchema = z.object({
  messageId: z.string().min(1),
  references: z.array(z.string()),
  inReplyTo: z.string().nullable(),
  subject: z.string(),
  from: AddressSchema,
  date: IsoDateTimeSchema,
  text: z.string(),
});
export type OriginalMessage = z.infer<typeof OriginalMessageSchema>;

/** Where a saved draft is in the mailbox's Drafts folder, to replace or delete it (F6.4). */
export const DraftRefSchema = z.object({
  path: z.string().min(1),
  uid: z.number().int().nonnegative(),
  uidValidity: z.number().int().nonnegative(),
  /** The draft's own Message-ID header. */
  draftMessageId: z.string().min(1),
});
export type DraftRef = z.infer<typeof DraftRefSchema>;

/** A file attached to a draft (the chosen CV, F6.3). */
export const DraftAttachmentSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  bytes: z.instanceof(Uint8Array),
});
export type DraftAttachment = z.infer<typeof DraftAttachmentSchema>;

/** saveDraft's and replaceDraft's input: the original it replies to, the reply, an attachment. */
export const DraftMailInputSchema = z.object({
  original: OriginalMessageSchema,
  reply: z.object({ subject: z.string(), body: z.string() }),
  attachment: DraftAttachmentSchema.nullable(),
  /**
   * The draft's own Message-ID header ("<...>") when the caller chose it; the client makes one
   * when absent. draft.create chooses and keeps it before the append, so a retry after an append
   * whose outcome it never recorded can find and delete that copy first (one copy, F6.3, F6.4).
   */
  draftMessageId: z.string().min(1).optional(),
});
export type DraftMailInput = z.infer<typeof DraftMailInputSchema>;

// --- MVP 3: several mailboxes, OAuth sign-in and what a disconnect removes ---------------------

/**
 * What packages/mail signs in with: the connection with its password, or (XOAUTH2) with an OAuth
 * access token instead. The secret never leaves the server.
 */
export const OAuthMailConnectionSchema = MailConnectionSchema.omit({ password: true }).extend({
  accessToken: z.string().min(1),
});
export type OAuthMailConnection = z.infer<typeof OAuthMailConnectionSchema>;
export type MailLogin = MailConnection | OAuthMailConnection;

/**
 * DELETE /mailboxes/:mailboxId asks first (F7.4): GET /mailboxes/:mailboxId/removal says what
 * goes with it — its credentials, its synced messages and everything tied to them — and that
 * drafts and mail in the mailbox itself stay there.
 */
export const MailboxRemovalSummarySchema = z.object({
  address: z.string(),
  messages: z.number().int().nonnegative(),
  roles: z.number().int().nonnegative(),
  drafts: z.number().int().nonnegative(),
  decisions: z.number().int().nonnegative(),
});
export type MailboxRemovalSummary = z.infer<typeof MailboxRemovalSummarySchema>;

/** A message's mailbox, as the inbox shows it on every message (F3.1). */
export const MessageMailboxSchema = z.object({ id: z.uuid(), address: z.string() });
export type MessageMailbox = z.infer<typeof MessageMailboxSchema>;
