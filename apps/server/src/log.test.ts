import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, redact } from "./log";

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
