import type {
  Envelope,
  MailConnection,
  MailFolder,
  MailPreset,
  MailTestResult,
  MessageRef,
} from "@jobfilly/schema";

// Mail access: IMAP (imapflow) and parsing (mailparser). Nothing in this package sends mail on
// its own; sending is one explicit call per message, made only after the user pressed send.
// The connect slice implements this module; the names and types below are the contract.

/** Provider presets (F2.1, F2.2); "other" leaves host, port and TLS to the user. */
export const MAIL_PRESETS: readonly MailPreset[] = [];

export interface MailClientOptions {
  /** Plain-text IMAP is refused unless JOBFILLY_ALLOW_INSECURE_MAIL=true (F2.4). */
  allowInsecure: boolean;
}

export interface MailClient {
  /** Connects and lists the folders, finding Sent; never reports the password. */
  test(): Promise<MailTestResult>;
  /** Envelopes of one folder since `since`, newest first, with a snippet of the plain text. */
  fetchEnvelopes(query: { folder: MailFolder; since: Date }): Promise<Envelope[]>;
  /** The sanitised plain text, or null when the folder's UIDVALIDITY no longer matches. */
  fetchBody(ref: MessageRef): Promise<{ text: string } | null>;
  close(): Promise<void>;
}

export function createMailClient(_conn: MailConnection, _options: MailClientOptions): MailClient {
  throw new Error("createMailClient is not built yet (connect slice)");
}
