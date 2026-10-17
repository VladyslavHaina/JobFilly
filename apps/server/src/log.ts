import { MailUnavailableError } from "@jobfilly/mail";
import type { LogLevel } from "./config";

// JSON lines on stdout (ARCHITECTURE › Logs): time, level, instance, event, and ids. Passwords,
// keys, tokens, cookies, bodies, subjects, email addresses, Message-IDs, AI output, CV text and
// assistant messages and proposals (F8.10) are never written: fields with those names are
// redacted, and anything shaped like an email address or a Message-ID is masked wherever it
// appears in a value. assistant.proposal_created logs `changes` as a count, never the changes.

/** The events of MVP 1 and MVP 2 (each MVP's › Log events), plus a few operational ones. */
export type LogEvent =
  | "http.request"
  | "http.error"
  | "db.migrated"
  | "db.connection_error"
  | "config.invalid"
  | "auth.registered"
  | "auth.signed_in"
  | "auth.sign_in_failed"
  | "auth.signed_out"
  | "workspace.invite_created"
  | "workspace.invite_accepted"
  | "workspace.role_changed"
  | "mailbox.connected"
  | "mailbox.test_failed"
  | "ai.settings_saved"
  | "ai.test_failed"
  | "ai.output_invalid"
  | "scan.started"
  | "scan.batch_completed"
  | "scan.stopped"
  | "scan.resumed"
  | "job.lease_expired"
  | "job.failed"
  | "job.handed_back"
  | "live.error"
  | "intake.confirmed"
  | "intake.extras_failed"
  | "server.ready"
  | "server.shutting_down"
  | "server.stopped"
  // MVP 2 (MVP-2.md › Log events)
  | "sync.started"
  | "sync.completed"
  | "sync.failed"
  | "sync.uidvalidity_changed"
  | "pipeline.message_processed"
  | "cv.uploaded"
  | "cv.skill_dropped"
  | "match.scored"
  | "rule.applied"
  | "sender.checked"
  | "sender.lookup_incomplete"
  | "draft.created"
  | "draft.saved_to_mailbox"
  | "draft.updated"
  | "draft.discarded"
  | "draft.rejected_placeholder"
  | "draft.rejected_language"
  | "decision.created"
  | "decision.answered"
  | "assistant.message"
  | "assistant.proposal_created"
  | "assistant.proposal_applied"
  | "assistant.proposal_discarded"
  | "profile.change_undone"
  // Operational: assistant.v1 gave no answer (the turn is a 502), with the AI error's codes.
  | "assistant.failed"
  // Operational: a pipeline stage or the sweep failed for one item (it is retried later; a stage
  // failure says why with failureFields, and when it is tried again), or a message's body was
  // gone from the mailbox (its sender check is stored incomplete), or the sweep has incomplete
  // sender checks done again once their failed lookup expired.
  | "pipeline.stage_failed"
  | "pipeline.sweep_failed"
  | "pipeline.message_gone"
  | "sender.lookup_retry"
  // Operational: a mailbox copy a change made, which should have gone again (it lost a race),
  // couldn't be deleted safely (reason delete_failed or uid_unknown), so it may still be in the
  // Drafts folder beside the draft's own copy.
  | "draft.copy_left"
  // Operational: an edit of a draft whose CV was deleted (F2.5) couldn't read the file back from
  // its mailbox copy (the copy is gone), so the new copy has no attachment.
  | "draft.attachment_lost"
  // Operational: a cv.read job threw, why with failureFields. Before the read was saved the CV is
  // marked failed; after it (step reevaluate) its re-evaluation is asked for once more.
  | "cv.read_failed"
  // MVP 3 (MVP-3.md › Log events; scan.started carries kind: rerun)
  | "profile.assigned"
  | "profile.updated"
  | "mailbox.oauth_connected"
  | "mailbox.reconnect_needed"
  | "send.confirmed"
  | "send.undone"
  | "send.completed"
  | "pipeline.stage_changed"
  | "member.scope_changed"
  | "member.role_changed"
  | "member.removed"
  | "workspace.ownership_transferred"
  | "export.completed"
  | "workspace.deleted"
  | "account.deleted"
  | "assistant.answered"
  // Operational (MVP 3): a send that failed (why with failureFields), a mailbox disconnected
  // (F7.4), a member who left (F6.3), and an OAuth callback refused (a wrong or used state,
  // F3.2), with a reason code only.
  | "send.failed"
  | "mailbox.disconnected"
  | "member.left"
  | "oauth.callback_refused";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: LogEvent, fields?: LogFields): void;
  info(event: LogEvent, fields?: LogFields): void;
  warn(event: LogEvent, fields?: LogFields): void;
  error(event: LogEvent, fields?: LogFields): void;
  fatal(event: LogEvent, fields?: LogFields): void;
  /** A logger that adds `fields` (such as requestId) to every line. */
  child(fields: LogFields): Logger;
}

const RANK = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 } as const;
type Level = keyof typeof RANK;

/** Field names whose values are never logged (compared lower case, without - and _). */
const SECRET_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "secretciphertext",
  "key",
  "apikey",
  "keyciphertext",
  "token",
  "tokenhash",
  "cookie",
  "cookies",
  "setcookie",
  "authorization",
  "body",
  "text",
  "html",
  "snippet",
  "subject",
  "address",
  "addresses",
  "email",
  "from",
  "to",
  "cc",
  "bcc",
  "replyto",
  "messageid",
  "messageids",
  "inreplyto",
  "references",
  "preferences",
  "content",
  "prompt",
  "output",
  "query",
  // MVP 2: drafts, decisions and the assistant (F8.10).
  "reply",
  "question",
  "choices",
  "summary",
  "request",
  "clarify",
  "proposal",
  "description",
  "before",
  "after",
  // MVP 3: OAuth tokens and the PKCE verifier (F3.2), a re-run's hint (F1.1) and the words the
  // assistant looks for (F8).
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "clientsecret",
  "verifier",
  "codeverifier",
  "hint",
  "words",
]);

export const REDACTED = "[redacted]";

// "<anything@anything>" (a Message-ID) or a bare email address.
const SENSITIVE_IN_TEXT = /<[^\s<>]*@[^\s<>]*>|[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""));
}

/** A copy of `value` that is safe to log. */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(SENSITIVE_IN_TEXT, REDACTED);
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return REDACTED;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactError(value, depth);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSecretKey(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

// Drizzle wraps every failed query in an error whose message is "Failed query: <sql>\nparams:
// <every bound value>" and whose cause is the driver's error. The values may be mail content,
// profile answers or ciphertexts, so nothing from "Failed query:" on is ever logged.
const FAILED_QUERY = /Failed query:[\s\S]*/;
// A pg SQLSTATE ("23505") or a Node system error code ("ECONNREFUSED").
const ERROR_CODE = /^[A-Za-z0-9_]{1,32}$/;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : undefined;
}

/**
 * An error as it is logged: its name, its code if it has one, and its masked message; stack
 * traces are never logged. A failed query keeps only the driver's code and message, never the
 * SQL or its bound parameters.
 */
function redactError(error: Error, depth: number): Record<string, unknown> {
  const failedQuery = FAILED_QUERY.test(error.message) || ("query" in error && "params" in error);
  if (!failedQuery) {
    const code = errorCode(error);
    return {
      name: error.name,
      ...(code ? { code } : {}),
      // The message may quote input, so it is masked too.
      message: redact(error.message, depth + 1),
    };
  }
  // Drizzle's error keeps the default name "Error"; its class name says what it is.
  const name = error.name === "Error" ? error.constructor.name || error.name : error.name;
  const cause = error.cause instanceof Error ? error.cause : undefined;
  const code = errorCode(cause) ?? errorCode(error);
  // Without a cause, what's left of the message ("Failed query", or a wrapper's own words).
  const message = (cause?.message ?? error.message).replace(FAILED_QUERY, "Failed query");
  return { name, ...(code ? { code } : {}), message: redact(message, depth + 1) };
}

/** The longest reason a failure line carries. */
export const MAX_FAILURE_REASON = 200;
// A kind the error names itself: an AI task error's kind (unreachable, invalid_output…), a mail
// error's reason (wrong_password, tls…). Anything else in those fields is left out.
const ERROR_KIND = /^[a-z][a-z0-9_]{0,31}$/;

function errorKind(error: Error): string | undefined {
  if (error instanceof MailUnavailableError) return "mailbox_unavailable";
  for (const field of ["kind", "reason"] as const) {
    const value = (error as Partial<Record<typeof field, unknown>>)[field];
    if (typeof value === "string" && ERROR_KIND.test(value)) return value;
  }
  return undefined;
}

/** Why something failed, as a log line carries it (see failureFields). */
export interface FailureFields {
  error: string;
  kind?: string;
  code?: string;
  reason: string;
}

/**
 * Why something failed, safe to log (pipeline.stage_failed): the error's name, the kind it names
 * (AI and mail errors), its code (a pg SQLSTATE, a Node system error), and its message masked as
 * every logged error's is (a failed query's SQL and values dropped, addresses and Message-IDs
 * masked), on one line of at most MAX_FAILURE_REASON characters. Nothing else an error carries is
 * read: not its stack, its cause's detail, or an SDK error's request or response body.
 */
export function failureFields(error: unknown): FailureFields {
  if (!(error instanceof Error)) {
    return { error: "unknown", reason: "Something that isn't an error was thrown" };
  }
  const logged = redactError(error, 0);
  const kind = errorKind(error);
  const code = typeof logged.code === "string" ? logged.code : undefined;
  const message = String(logged.message ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const reason =
    message.length > MAX_FAILURE_REASON
      ? `${message.slice(0, MAX_FAILURE_REASON - 1)}…`
      : message || "No reason given";
  return {
    error: String(logged.name),
    ...(kind ? { kind } : {}),
    ...(code ? { code } : {}),
    reason,
  };
}

export interface LoggerOptions {
  level: LogLevel;
  instance: string;
  /** Where each JSON line goes; stdout by default. */
  write?: (line: string) => void;
  now?: () => Date;
}

export function createLogger(options: LoggerOptions, base: LogFields = {}): Logger {
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const min = RANK[options.level];

  const emit = (level: Level, event: LogEvent, fields: LogFields = {}) => {
    if (RANK[level] < min) return;
    const safe = redact({ ...base, ...fields }) as LogFields;
    // The fixed fields come first and can't be overwritten by `fields`.
    const { time: _t, level: _l, instance: _i, event: _e, ...rest } = safe;
    write(
      JSON.stringify({
        time: now().toISOString(),
        level,
        instance: options.instance,
        event,
        ...rest,
      }),
    );
  };

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    fatal: (event, fields) => emit("fatal", event, fields),
    child: (fields) => createLogger(options, { ...base, ...fields }),
  };
}
