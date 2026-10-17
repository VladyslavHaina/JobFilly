import type { SmtpEnvelope, SmtpLogin, SmtpTestResult } from "@jobfilly/schema";

// Sending (MVP 3, F4): the one place in packages/mail allowed to open an SMTP connection, with a
// password or an OAuth access token (XOAUTH2). The server reaches it only through its SmtpPort
// (apps/server deps.ts), and only the send job sends: one confirmed message at a time, never in
// bulk. Built by the send slice; until then both functions refuse.

export interface SmtpOptions {
  /** JOBFILLY_ALLOW_INSECURE_MAIL: plain-text SMTP is refused unless the test stack allows it. */
  allowInsecure: boolean;
}

const NOT_BUILT = "SMTP sending is not built yet (MVP 3, send slice)";

/**
 * Sends one message, its exact RFC 5322 bytes, to the envelope's recipients; resolves with the
 * addresses the server accepted. The same bytes go to the Sent folder (MailClient.appendSent).
 */
export async function sendSmtp(
  _login: SmtpLogin,
  _envelope: SmtpEnvelope,
  _raw: Uint8Array,
  _options: SmtpOptions,
): Promise<{ accepted: string[] }> {
  throw new Error(NOT_BUILT);
}

/** Signs in to the SMTP server without sending anything: Settings › Sending's Test button. */
export async function testSmtp(_login: SmtpLogin, _options: SmtpOptions): Promise<SmtpTestResult> {
  throw new Error(NOT_BUILT);
}
