import type { MailTestFailureReason } from "@jobfilly/schema";

// Why a mailbox can't be used, in plain words. The words are fixed per reason, so nothing the
// user typed, and never the password, can end up in a message or a log line.

export const FAILURE_MESSAGES: Record<MailTestFailureReason, string> = {
  wrong_password:
    "The mail server didn't accept the user name or password. Some providers need an app password.",
  unreachable: "The mail server can't be reached. Check the server name and the port.",
  tls: "A secure connection to the mail server couldn't be set up. Check the port and the security setting.",
  insecure_refused:
    "Plain-text IMAP is turned off on this server. Choose TLS or STARTTLS to protect your password.",
};

/** A mailbox failure with its reason; the message is one of FAILURE_MESSAGES. */
export class MailError extends Error {
  constructor(readonly reason: MailTestFailureReason) {
    super(FAILURE_MESSAGES[reason]);
    this.name = "MailError";
  }
}

const TLS_CODE =
  /^(ERR_SSL|ERR_TLS|EPROTO|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|HOSTNAME_MISMATCH|ClosedAfterConnectTLS|UPGRADE_TIMEOUT)/;

interface ImapLikeError {
  code?: unknown;
  authenticationFailed?: unknown;
  serverResponseCode?: unknown;
  message?: unknown;
}

/** Maps an error from the IMAP library, the socket or TLS to a reason the user can act on. */
export function failureReason(error: unknown): MailTestFailureReason {
  if (error instanceof MailError) return error.reason;
  const e = (typeof error === "object" && error !== null ? error : {}) as ImapLikeError;
  const code = typeof e.code === "string" ? e.code : "";
  if (e.authenticationFailed === true || e.serverResponseCode === "AUTHENTICATIONFAILED") {
    return "wrong_password";
  }
  if (TLS_CODE.test(code)) return "tls";
  const message = typeof e.message === "string" ? e.message : "";
  // A required STARTTLS the server doesn't offer, or a TLS socket that got plain text back.
  if (/STARTTLS|\bTLS\b|\bSSL\b|wrong version number|certificate/i.test(message)) return "tls";
  return "unreachable";
}
