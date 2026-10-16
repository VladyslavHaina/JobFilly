import { MailUnavailableError } from "@jobfilly/mail";
import { describe, expect, it } from "vitest";
import { createLogger, failureFields, MAX_FAILURE_REASON, REDACTED, redact } from "./log";

function capture(level: "debug" | "info" | "warn" | "error" = "info") {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    level,
    instance: "app-a",
    write: (line) => lines.push(JSON.parse(line)),
    now: () => new Date("2026-10-01T10:00:00.000Z"),
  });
  return { log, lines };
}

describe("the logger", () => {
  it("writes one JSON line with time, level, instance and event first", () => {
    const { log, lines } = capture();
    log.info("http.request", {
      method: "GET",
      route: "/api/health/live",
      status: 200,
      durationMs: 3,
    });
    expect(lines).toEqual([
      {
        time: "2026-10-01T10:00:00.000Z",
        level: "info",
        instance: "app-a",
        event: "http.request",
        method: "GET",
        route: "/api/health/live",
        status: 200,
        durationMs: 3,
      },
    ]);
  });

  it("keeps ids from a child logger and never lets fields overwrite the fixed ones", () => {
    const { log, lines } = capture();
    log
      .child({ requestId: "r1", workspaceId: "w1", userId: "u1" })
      .warn("auth.sign_in_failed", { instance: "evil", level: "debug" });
    expect(lines[0]).toMatchObject({
      level: "warn",
      instance: "app-a",
      event: "auth.sign_in_failed",
      requestId: "r1",
      workspaceId: "w1",
      userId: "u1",
    });
  });

  it("drops lines below the level", () => {
    const { log, lines } = capture("warn");
    log.info("server.ready");
    log.debug("server.ready");
    log.error("http.error");
    expect(lines.map((l) => l.level)).toEqual(["error"]);
  });

  it("redacts secrets, mail content, addresses and Message-IDs", () => {
    const { log, lines } = capture();
    log.info("mailbox.connected", {
      password: "E2E-SECRET-maria-imap",
      apiKey: "E2E-SECRET-ai-key",
      api_key: "x",
      cookie: "jf_session=abc",
      subject: "Senior backend role",
      body: "BODYSENTINEL-1",
      email: "maria.santos@inbox.example",
      messageId: "<abc@mail.example>",
      nested: { secret_ciphertext: "v1.x", items: [{ text: "hello" }] },
      note: "from maria.santos@inbox.example about <m1+x/y@mail.example>",
      workspaceId: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
    });
    const line = JSON.stringify(lines[0]);
    for (const leak of [
      "E2E-SECRET",
      "jf_session",
      "Senior backend",
      "BODYSENTINEL",
      "inbox.example",
      "mail.example",
      "v1.x",
      "hello",
    ]) {
      expect(line).not.toContain(leak);
    }
    expect(lines[0]).toMatchObject({
      password: REDACTED,
      note: `from ${REDACTED} about ${REDACTED}`,
      workspaceId: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
    });
  });

  it("logs errors by name and masked message, never their stack", () => {
    const error = new Error("connect failed for maria@inbox.example");
    expect(redact({ error })).toEqual({
      error: { name: "Error", message: `connect failed for ${REDACTED}` },
    });
  });
});

// The shape of drizzle-orm's DrizzleQueryError: the default name "Error", the full SQL and every
// bound value in the message, and the driver's error as the cause.
class DrizzleQueryError extends Error {
  constructor(
    readonly query: string,
    readonly params: unknown[],
    cause?: unknown,
  ) {
    super(`Failed query: ${query}\nparams: ${params}`);
    this.cause = cause;
  }
}

// pg's DatabaseError: the server's message and the SQLSTATE code, plus detail that can quote values.
function pgError(message: string, code: string, detail: string) {
  return Object.assign(new Error(message), { name: "error", code, detail, severity: "ERROR" });
}

const SQL = 'insert into "messages" ("subject", "snippet") values ($1, $2)';
const PARAMS = ["PARAMSENTINEL-subject", "PARAMSENTINEL-snippet maria@inbox.example"];

describe("database errors in the log", () => {
  it("never logs the SQL or the bound values of a failed query", () => {
    const { log, lines } = capture();
    log.warn("db.connection_error", { error: new DrizzleQueryError(SQL, PARAMS) });
    const line = JSON.stringify(lines[0]);
    for (const leak of ["PARAMSENTINEL", "inbox.example", "insert into", "messages", "params"]) {
      expect(line).not.toContain(leak);
    }
    expect(lines[0]?.error).toEqual({ name: "DrizzleQueryError", message: "Failed query" });
  });

  it("keeps the pg code and the cause's masked message, never the detail", () => {
    const cause = pgError(
      'duplicate key value violates unique constraint "users_email" for maria@inbox.example',
      "23505",
      "Key (email)=(PARAMSENTINEL-detail) already exists.",
    );
    const { log, lines } = capture();
    log.warn("db.connection_error", { error: new DrizzleQueryError(SQL, PARAMS, cause) });
    const line = JSON.stringify(lines[0]);
    for (const leak of ["PARAMSENTINEL", "inbox.example", "insert into", "params"]) {
      expect(line).not.toContain(leak);
    }
    expect(lines[0]?.error).toEqual({
      name: "DrizzleQueryError",
      code: "23505",
      message: `duplicate key value violates unique constraint "users_email" for ${REDACTED}`,
    });
  });

  it("logs a driver error by name, code and message", () => {
    const connect = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
      code: "ECONNREFUSED",
    });
    expect(redact({ error: connect })).toEqual({
      error: { name: "Error", code: "ECONNREFUSED", message: "connect ECONNREFUSED 10.0.0.5:5432" },
    });
  });

  it("drops a failed query quoted inside another error's message", () => {
    const wrapped = new Error(`scan failed: Failed query: ${SQL}\nparams: ${PARAMS}`);
    expect(redact({ error: wrapped })).toEqual({
      error: { name: "Error", message: "scan failed: Failed query" },
    });
  });
});

describe("MVP 2's secret fields (F8.10)", () => {
  it("redacts drafts, decisions, assistant messages and proposals, and profile snapshots", () => {
    const fields = {
      reply: "E2E-CHAT-1 reply",
      question: "Minimum pay in CHF per year?",
      choices: ["CHF 120,000"],
      summary: "Hide Asian time zones",
      request: "E2E-CHAT-2 lately I don't want…",
      clarify: { question: "Which ones?", choices: ["a"] },
      proposal: { summary: "s", changes: [] },
      description: "Hide roles whose hours are UTC+05:00 or later",
      before: { entries: [{ key: "min_pay", value: [] }] },
      after: { entries: [] },
      Reply_To: "kept as replyto, also redacted",
    };
    const safe = redact(fields) as Record<string, unknown>;
    for (const key of Object.keys(fields)) expect(safe[key]).toBe(REDACTED);
    const lines: string[] = [];
    const log = createLogger({ level: "info", instance: "app-a", write: (l) => lines.push(l) });
    log.info("assistant.proposal_created", { proposalId: "p1", changes: 2, ...fields });
    expect(lines[0]).not.toMatch(/E2E-CHAT|CHF|UTC\+05|Hide/);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ proposalId: "p1", changes: 2 });
  });
});

describe("why a pipeline stage failed (failureFields)", () => {
  // The shape of an AI SDK call error: the prompt and the provider's answer ride along.
  function sdkError() {
    return Object.assign(new Error("Bad Request from the provider"), {
      name: "AI_APICallError",
      requestBodyValues: { messages: [{ content: "BODYSENTINEL-prompt E2E-SECRET-ai-key" }] },
      responseBody: "BODYSENTINEL-answer",
      text: "BODYSENTINEL-text",
      stack: "Error\n    at BODYSENTINEL-stack",
    });
  }

  it("says why with the name, the kind or code, and a short masked reason", () => {
    const { log, lines } = capture();
    const ai = Object.assign(new Error("match.v1 gave no answer: unreachable"), {
      name: "MatchAiError",
      kind: "unreachable",
    });
    const mail = Object.assign(new Error("The mail server can't be reached."), {
      name: "MailError",
      reason: "unreachable",
    });
    const socket = Object.assign(
      new Error("connect ECONNREFUSED imap.example as maria@x.example"),
      {
        code: "ECONNREFUSED",
      },
    );
    log.warn("pipeline.stage_failed", { stage: "match", position: 0, ...failureFields(ai) });
    log.warn("pipeline.stage_failed", { stage: "sender", ...failureFields(mail) });
    log.warn("pipeline.stage_failed", { stage: "sender", ...failureFields(socket) });
    log.warn("pipeline.stage_failed", {
      stage: "sender",
      ...failureFields(new MailUnavailableError()),
    });
    log.warn("pipeline.stage_failed", { stage: "reply", ...failureFields("a string") });
    expect(lines).toMatchObject([
      {
        error: "MatchAiError",
        kind: "unreachable",
        reason: "match.v1 gave no answer: unreachable",
      },
      { error: "MailError", kind: "unreachable", reason: "The mail server can't be reached." },
      {
        error: "Error",
        code: "ECONNREFUSED",
        reason: `connect ECONNREFUSED imap.example as ${REDACTED}`,
      },
      {
        error: "MailUnavailableError",
        kind: "mailbox_unavailable",
        reason: "Couldn't reach the mail server",
      },
      { error: "unknown", reason: "Something that isn't an error was thrown" },
    ]);
  });

  it("never carries bodies, prompts, secrets, stacks or a failed query's values", () => {
    const { log, lines } = capture();
    const query = new DrizzleQueryError(SQL, ["BODYSENTINEL-1", "E2E-SECRET-maria-imap"]);
    const wrapped = Object.assign(new Error("the stage failed"), {
      cause: sdkError(),
      password: "E2E-SECRET-maria-imap",
      body: "BODYSENTINEL-2",
    });
    for (const error of [sdkError(), query, wrapped]) {
      log.warn("pipeline.stage_failed", { stage: "match", ...failureFields(error) });
    }
    const text = lines.map((l) => JSON.stringify(l)).join("\n");
    for (const leak of ["BODYSENTINEL", "E2E-SECRET", "insert into", "params", "stack"]) {
      expect(text).not.toContain(leak);
    }
    expect(lines).toMatchObject([
      { error: "AI_APICallError", reason: "Bad Request from the provider" },
      { error: "DrizzleQueryError", reason: "Failed query" },
      { error: "Error", reason: "the stage failed" },
    ]);
  });

  it("keeps the reason on one bounded line", () => {
    const long = new Error(`first line\n${"x".repeat(500)}`);
    const { reason } = failureFields(long);
    expect(reason).toHaveLength(MAX_FAILURE_REASON);
    expect(reason.startsWith("first line x")).toBe(true);
    expect(reason.endsWith("…")).toBe(true);
    expect(failureFields(new Error("")).reason).toBe("No reason given");
  });
});
