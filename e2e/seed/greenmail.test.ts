import { describe, expect, it } from "vitest";
import { greenMailApi } from "./greenmail.ts";
import { SeedError } from "./load.ts";

// The GreenMail API client against a recorded fetch, in the shapes GreenMail 2.1's standalone
// API answers (GreenMailApiResource: /api/user, /api/user/{email}/messages/).

function recorder(answers: Record<string, { status: number; body: unknown }>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method ?? "GET",
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers[`${init.method} ${url}`] ?? { status: 404, body: { message: "no" } };
    return new Response(answer.body === null ? "" : JSON.stringify(answer.body), {
      status: answer.status,
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const BASE = "http://imap:8080";

describe("greenMailApi", () => {
  it("lists users and a user's Inbox messages by Message-ID and subject", async () => {
    const { fetchImpl } = recorder({
      "GET http://imap:8080/api/user": {
        status: 200,
        body: [{ login: "maria.santos@inbox.example", email: "maria.santos@inbox.example" }],
      },
      "GET http://imap:8080/api/user/maria.santos%40inbox.example/messages/": {
        status: 200,
        body: [
          {
            uid: "1",
            "Message-ID": "<a@x.example>",
            subject: "Hi",
            contentType: "text/plain",
            mimeMessage: "…",
          },
        ],
      },
    });
    const api = greenMailApi(`${BASE}/`, fetchImpl);
    expect(await api.users()).toEqual([
      { email: "maria.santos@inbox.example", login: "maria.santos@inbox.example" },
    ]);
    expect(await api.inbox("maria.santos@inbox.example")).toEqual([
      { messageId: "<a@x.example>", subject: "Hi" },
    ]);
  });

  it("deletes and creates a user", async () => {
    const { calls, fetchImpl } = recorder({
      "DELETE http://imap:8080/api/user/tom.okafor%40inbox.example": { status: 200, body: {} },
      "POST http://imap:8080/api/user": { status: 200, body: {} },
    });
    const api = greenMailApi(BASE, fetchImpl);
    await api.deleteUser("tom.okafor@inbox.example");
    await api.createUser({ email: "t@x.example", login: "t@x.example", password: "E2E-SECRET-x" });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["DELETE", "http://imap:8080/api/user/tom.okafor%40inbox.example", undefined],
      [
        "POST",
        "http://imap:8080/api/user",
        { email: "t@x.example", login: "t@x.example", password: "E2E-SECRET-x" },
      ],
    ]);
  });

  it("turns an error answer or an unreachable server into a SeedError", async () => {
    const { fetchImpl } = recorder({});
    await expect(greenMailApi(BASE, fetchImpl).users()).rejects.toThrow(
      new SeedError("The mail server's API answered 404 to GET /api/user"),
    );
    const down = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(greenMailApi(BASE, down).users()).rejects.toThrow(
      /Can't reach the mail server's API/,
    );
  });
});
