import type {
  MailTestFailureReason,
  SmtpEnvelope,
  SmtpLogin,
  SmtpTestResult,
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
export const SMTP_FAILURE_MESSAGES: Record<MailTestFailureReason, string> = {
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

const TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000 };

function transportFor(login: SmtpLogin, options: SmtpOptions) {
  if (login.tlsMode === "none" && !options.allowInsecure) throw new SmtpError("insecure_refused");
  return createTransport({
    host: login.host,
    port: login.port,
    secure: login.tlsMode === "tls",
    requireTLS: login.tlsMode === "starttls",
    ignoreTLS: login.tlsMode === "none",
    auth:
      "accessToken" in login
        ? { type: "OAuth2", user: login.username, accessToken: login.accessToken }
        : { user: login.username, pass: login.password },
    ...TIMEOUTS,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

const TLS_CODE = /^(ETLS|ERR_SSL|ERR_TLS|EPROTO|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_)/;

/** The reason for an SMTP failure, from nodemailer's error codes (never its message text). */
function asSmtpError(error: unknown): SmtpError {
  if (error instanceof SmtpError) return error;
  const e = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    responseCode?: unknown;
  };
  const code = typeof e.code === "string" ? e.code : undefined;
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
    return { ok: false, reason: failure.reason, message: failure.message };
  }
}
