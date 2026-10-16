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

/**
 * A mailbox failure with its reason; the message is one of FAILURE_MESSAGES. `code` is the
 * failure's own code ("NoConnection", "ECONNRESET") when it is one isMailFailure knows, for the
 * logs; never the server's words.
 */
export class MailError extends Error {
  constructor(
    readonly reason: MailTestFailureReason,
    readonly code?: string,
  ) {
    super(FAILURE_MESSAGES[reason]);
    this.name = "MailError";
  }
}

const TLS_CODE =
  /^(ERR_SSL|ERR_TLS|EPROTO|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|HOSTNAME_MISMATCH|ClosedAfterConnectTLS|UPGRADE_TIMEOUT)/;

interface ImapLikeError {
  code?: unknown;
  authenticationFailed?: unknown;
  tlsFailed?: unknown;
  serverResponseCode?: unknown;
  responseStatus?: unknown;
  message?: unknown;
}

const asImapLike = (error: unknown) =>
  (typeof error === "object" && error !== null ? error : {}) as ImapLikeError;

/**
 * The codes imapflow sets on its own connection, timeout, server-response and parser failures
 * (its ImapFlowErrorCode, for these kinds); its parser errors are ParserError plus a number.
 */
const IMAPFLOW_CODE =
  /^(NoConnection|EConnectionClosed|StateLogout|ClosedAfterConnect(Text|TLS)|(CONNECT|GREETING|UPGRADE)_TIMEOUT|ETIMEOUT|LockTimeout|ETHROTTLE|UnexpectedTag|InvalidResponse|ResponseProcessingFailed|STARTTLS_INJECTION|COMPRESS_TRAILING_DATA|PollFailed|NotFound|MissingServerExtension|ParserError\w*|MAX_IMAP_NESTING_REACHED|LineTooLarge|LiteralTooLarge|ResponseTooLarge|ProxyError|EPROXY)$/;

/**
 * The socket and DNS codes Node sets when the network or the server fails, named one by one:
 * Node's own programming-error codes (ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE, ...) and the
 * file system's (ENOENT, EACCES, ...) also start with E, and are the app's, not the server's.
 */
const SOCKET_CODES: ReadonlySet<string> = new Set([
  // The connection.
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "ENETUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "EADDRNOTAVAIL",
  "ENOTCONN",
  // Name resolution (getaddrinfo and the DNS resolver).
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "EAI_NONAME",
  "EAI_NODATA",
  "ENODATA",
  "ESERVFAIL",
  "EREFUSED",
  "EBADRESP",
]);

/** Node's codes for a socket that closed or timed out: ERR_SOCKET_CLOSED, ... */
const NODE_SOCKET_CODE = /^ERR_SOCKET_(CLOSED|CLOSED_BEFORE_CONNECTION|CONNECTION_TIMEOUT)$/;

/**
 * Whether an error is the mail server's: the connection (socket, DNS, timeouts), the IMAP
 * session (a refused login, a NO or BAD answer, a response imapflow couldn't read) or TLS. Only
 * these mean the mailbox can't be used right now; anything else (a bug, a value no schema
 * allows) is the app's, and is passed on as it is, so it isn't shown as an unreachable server.
 */
export function isMailFailure(error: unknown): boolean {
  if (error instanceof MailError) return true;
  const e = asImapLike(error);
  if (e.authenticationFailed === true || e.tlsFailed === true) return true;
  if (typeof e.responseStatus === "string" || typeof e.serverResponseCode === "string") {
    return true;
  }
  const code = typeof e.code === "string" ? e.code : "";
  return (
    IMAPFLOW_CODE.test(code) ||
    SOCKET_CODES.has(code) ||
    NODE_SOCKET_CODE.test(code) ||
    TLS_CODE.test(code)
  );
}

/**
 * imapflow's codes for a connection that is closed (a command can't be sent on it) or was closed
 * while a command ran.
 */
const DROPPED_CODE = /^(NoConnection|EConnectionClosed)$/;

/**
 * Whether the connection was closed or dropped under the session, as a server closes an idle
 * one: then a new connection may well work.
 */
export function isConnectionDropped(error: unknown): boolean {
  const code = asImapLike(error).code;
  return typeof code === "string" && DROPPED_CODE.test(code);
}

/** The code of a mail server failure, when it is one of the known codes above. */
export function mailErrorCode(error: unknown): string | undefined {
  const code = asImapLike(error).code;
  if (typeof code !== "string") return undefined;
  const known =
    IMAPFLOW_CODE.test(code) ||
    SOCKET_CODES.has(code) ||
    NODE_SOCKET_CODE.test(code) ||
    TLS_CODE.test(code);
  return known ? code : undefined;
}

/** Maps an error from the IMAP library, the socket or TLS to a reason the user can act on. */
export function failureReason(error: unknown): MailTestFailureReason {
  if (error instanceof MailError) return error.reason;
  const e = asImapLike(error);
  const code = typeof e.code === "string" ? e.code : "";
  if (e.authenticationFailed === true || e.serverResponseCode === "AUTHENTICATIONFAILED") {
    return "wrong_password";
  }
  if (e.tlsFailed === true || TLS_CODE.test(code)) return "tls";
  const message = typeof e.message === "string" ? e.message : "";
  // A required STARTTLS the server doesn't offer, or a TLS socket that got plain text back.
  if (/STARTTLS|\bTLS\b|\bSSL\b|wrong version number|certificate/i.test(message)) return "tls";
  return "unreachable";
}
