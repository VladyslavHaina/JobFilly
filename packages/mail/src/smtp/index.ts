import {
  type MailTestFailureReason,
  type SmtpEnvelope,
  type SmtpLogin,
  SmtpLoginSchema,
  type SmtpTestResult,
} from "@jobfilly/schema";
import { createTransport } from "nodemailer";

// Sending (MVP 3, F4): the one place in packages/mail allowed to open an SMTP connection, with a
// password or an OAuth access token (XOAUTH2). The server reaches it only through its SmtpPort
// (apps/server deps.ts), and only the send job sends: one confirmed message at a time, never in
// bulk. Each call opens its own connection and closes it; nothing is pooled, and the transport
// logs nothing (no address, text or secret).

export { composeOutgoing, type OutgoingMessage } from "./compose";

export interface SmtpOptions {
  /** JOBFILLY_ALLOW_INSECURE_MAIL: plain-text SMTP is refused unless the test stack allows it. */
  allowInsecure: boolean;
}

/** Why the SMTP server can't be used, in plain words; never the server's own words. */
const SMTP_FAILURE_MESSAGES: Record<MailTestFailureReason, string> = {
  wrong_password:
    "The SMTP server didn't accept the user name or password. Some providers need an app password.",
  unreachable: "The SMTP server can't be reached. Check the server name and the port.",
  tls: "A secure connection to the SMTP server couldn't be set up. Check the port and the security setting.",
  insecure_refused:
    "Plain-text SMTP is turned off on this server. Choose TLS or STARTTLS to protect your password.",
};

/** An SMTP failure with its reason; the message is one of SMTP_FAILURE_MESSAGES. */
export class SmtpError extends Error {
  constructor(
    readonly reason: MailTestFailureReason,
    /** The failure's own code (EAUTH, ETIMEDOUT, …), for the logs; never the server's words. */
    readonly code?: string,
  ) {
    super(SMTP_FAILURE_MESSAGES[reason]);
    this.name = "SmtpError";
  }
}

/** Every wait is bounded: name lookup, connecting, the greeting and each reply. */
export const SMTP_TIMEOUTS_MS = {
  dnsTimeout: 10_000,
  connectionTimeout: 15_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

/**
 * The transport's options, with the same policy as IMAP: the login is checked where it enters
 * (SmtpLoginSchema: a host name or IP address only, a port 1–65535), plain text is refused unless
 * JOBFILLY_ALLOW_INSECURE_MAIL allows it, and the connection goes to that one host and port —
 * no pool, proxy, well-known service or other host — with bounded timeouts and no logger.
 */
export function smtpTransportOptions(login: SmtpLogin, options: SmtpOptions) {
  const checked = SmtpLoginSchema.safeParse(login);
  if (!checked.success) throw new SmtpError("unreachable", "EBADHOST");
  const valid = checked.data;
  if (valid.tlsMode === "none" && !options.allowInsecure) throw new SmtpError("insecure_refused");
  return {
    host: valid.host,
    port: valid.port,
    secure: valid.tlsMode === "tls",
    requireTLS: valid.tlsMode === "starttls",
    ignoreTLS: valid.tlsMode === "none",
    auth:
      "accessToken" in valid
        ? { type: "OAuth2" as const, user: valid.username, accessToken: valid.accessToken }
        : { user: valid.username, pass: valid.password },
    ...SMTP_TIMEOUTS_MS,
    pool: false as const,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

const transportFor = (login: SmtpLogin, options: SmtpOptions) =>
  createTransport(smtpTransportOptions(login, options));

const TLS_CODE = /^(ETLS|ERR_SSL|ERR_TLS|EPROTO|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_)/;
/** What a code looks like when it is nodemailer's or Node's own (EAUTH, ECONNREFUSED, …). */
const OWN_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;

/**
 * The reason for an SMTP failure, from the error's code only: nothing the server said (its
 * banner, reply or error text) reaches the user or the logs.
 */
function asSmtpError(error: unknown): SmtpError {
  if (error instanceof SmtpError) return error;
  const e = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    responseCode?: unknown;
  };
  const code = typeof e.code === "string" && OWN_CODE.test(e.code) ? e.code : undefined;
  if (code === "EAUTH" || e.responseCode === 535) return new SmtpError("wrong_password", code);
  if (code && TLS_CODE.test(code)) return new SmtpError("tls", code);
  return new SmtpError("unreachable", code);
}

/**
 * Sends one message, its exact RFC 5322 bytes, to the envelope's recipients; resolves with the
 * addresses the server accepted. The same bytes go to the Sent folder (MailClient.appendSent).
 * Throws SmtpError when the server can't be reached, refuses the login or takes no recipient.
 */
export async function sendSmtp(
  login: SmtpLogin,
  envelope: SmtpEnvelope,
  raw: Uint8Array,
  options: SmtpOptions,
): Promise<{ accepted: string[] }> {
  const transport = transportFor(login, options);
  try {
    const info = await transport.sendMail({ envelope, raw: Buffer.from(raw) });
    const accepted = (info.accepted ?? []).map((a: string | { address: string }) =>
      typeof a === "string" ? a : a.address,
    );
    if (accepted.length === 0) throw new SmtpError("unreachable", "ENORECIPIENT");
    return { accepted };
  } catch (error) {
    throw asSmtpError(error);
  } finally {
    transport.close();
  }
}

/** Signs in to the SMTP server without sending anything: Settings › Sending's Test button. */
export async function testSmtp(login: SmtpLogin, options: SmtpOptions): Promise<SmtpTestResult> {
  try {
    const transport = transportFor(login, options);
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
    return { ok: true };
  } catch (error) {
    const failure = asSmtpError(error);
    return {
      ok: false,
      reason: failure.reason,
      message: failure.message,
      ...(failure.code ? { code: failure.code } : {}),
    };
  }
}
