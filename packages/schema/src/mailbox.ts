import { z } from "zod";
import { IsoDateTimeSchema } from "./common";

export const TlsModeSchema = z.enum(["tls", "starttls", "none"]);
export type TlsMode = z.infer<typeof TlsModeSchema>;

/** What packages/mail needs to reach an IMAP server. The password never leaves the server. */
export const MailConnectionSchema = z.object({
  host: z.string().trim().min(1, "Enter the server name"),
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

/** A provider preset: it fills host, port and TLS; "other" leaves them to the user. */
export const MailPresetSchema = z.object({
  id: MailPresetIdSchema,
  label: z.string(),
  host: z.string(),
  port: z.number().int(),
  tlsMode: TlsModeSchema,
  needsAppPassword: z.boolean(),
  helpUrl: z.url().nullable(),
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

export const MailboxStatusSchema = z.enum(["connected", "failing"]);
export type MailboxStatus = z.infer<typeof MailboxStatusSchema>;

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
});
export type MailboxPublic = z.infer<typeof MailboxPublicSchema>;

/** GET /mailboxes: the workspace's mailbox (one per workspace in MVP 1), if any. */
export const MailboxListSchema = z.object({ items: z.array(MailboxPublicSchema) });
export type MailboxList = z.infer<typeof MailboxListSchema>;

export const AddressSchema = z.object({ address: z.string(), name: z.string().nullable() });
export type Address = z.infer<typeof AddressSchema>;

export const MailFolderSchema = z.enum(["inbox", "sent"]);
export type MailFolder = z.infer<typeof MailFolderSchema>;

/** At most this many characters from the start of the plain text are kept as the snippet. */
export const SNIPPET_MAX_LENGTH = 200;

/**
 * The headers of one message, as packages/mail reads them. `messageId` is the RFC Message-ID,
 * verbatim from the header with its angle brackets, or a stable synthetic
 * "<folder.uidvalidity.uid@jobfilly.invalid>" when the header is missing. Everywhere outside the
 * database primary key a message is named by this string.
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

/** The synthetic Message-ID of a message whose header is missing. */
export function syntheticMessageId(folder: MailFolder, uidValidity: number, uid: number): string {
  return `<${folder}.${uidValidity}.${uid}@jobfilly.invalid>`;
}
