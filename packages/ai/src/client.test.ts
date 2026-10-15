import type { AiEvent, AiMailItem, AiTask, IntakeExtraInput } from "@jobfilly/schema";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { clientFromModels } from "./client";

// The client's validation, retry and usage rules, against the AI SDK's mock language model: no
// request leaves the process. The real wire format is pinned in wire-client.test.ts.

function item(n: number, extra: Partial<AiMailItem> = {}): AiMailItem {
  return {
    messageId: `<item-${n}@mail.example>`,
    folder: "inbox",
    from: { address: `sender${n}@agency.example`, name: `Sender ${n}` },
    date: "2026-09-28T08:15:00.000Z",
    subject: `Subject SECRET-SUBJECT-${n}`,
    text: `Body of message ${n}`,
    ...extra,
  };
}

/** A mock model that answers each call with the next text, recording every prompt it gets. */
function scripted(answers: string[]) {
  const prompts: string[] = [];
  let call = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const user = options.prompt.find((m) => m.role === "user");
      prompts.push(
        user && Array.isArray(user.content)
          ? user.content.map((p) => (p.type === "text" ? p.text : "")).join("")
          : "",
      );
      const text = answers[call] ?? "";
      call += 1;
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            total: 100 + call,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 10 + call, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

function clientWith(answers: string[]) {
  const { model, prompts } = scripted(answers);
  const events: AiEvent[] = [];
  const client = clientFromModels(() => ({ model }), { onEvent: (e) => events.push(e) });
  return { client, prompts, events };
}

const classified = (pairs: [n: number, category: string][]) =>
  JSON.stringify({
    items: pairs.map(([n, category]) => ({ messageId: `<item-${n}@mail.example>`, category })),
  });

const messageIdsIn = (prompt: string) =>
  prompt
    .split("\n")
    .filter((l) => l.startsWith("Message-ID: "))
    .map((l) => l.slice("Message-ID: ".length));

describe("batched tasks (F3.4, TBD-17)", () => {
  it("returns one result per item in the input's order, with one usage entry per call", async () => {
    const { client, prompts, events } = clientWith([
      classified([
        [2, "not_job"],
        [1, "interview"],
      ]),
    ]);
    const result = await client.classify([item(1), item(2)]);
    expect(result).toEqual({
      items: [
        { messageId: "<item-1@mail.example>", ok: true, data: { category: "interview" } },
        { messageId: "<item-2@mail.example>", ok: true, data: { category: "not_job" } },
      ],
      usage: [{ task: "classify.v1", inputTokens: 101, outputTokens: 11 }],
    });
    expect(prompts).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("retries only the invalid and missing items, once, in one call of the same layout", async () => {
    const { client, prompts, events } = clientWith([
      // item 1 valid, item 2 has a category that doesn't exist, item 3 is missing
      classified([
        [1, "offer"],
        [2, "definitely an offer"],
      ]),
      classified([
        [2, "rejection"],
        [3, "made up"],
      ]),
    ]);
    const result = await client.classify([item(1), item(2), item(3)]);
    expect(messageIdsIn(prompts[0] ?? "")).toEqual([
      "<item-1@mail.example>",
      "<item-2@mail.example>",
      "<item-3@mail.example>",
    ]);
    // The follow-up holds only the two failed items, numbered from 1 like any call.
    expect(messageIdsIn(prompts[1] ?? "")).toEqual([
      "<item-2@mail.example>",
      "<item-3@mail.example>",
    ]);
    expect(prompts[1]).toContain(
      "task: classify.v1\nitems: 2\n\n=== item 1 ===\nMessage-ID: <item-2@mail.example>",
    );
    expect(result.items).toEqual([
      { messageId: "<item-1@mail.example>", ok: true, data: { category: "offer" } },
      { messageId: "<item-2@mail.example>", ok: true, data: { category: "rejection" } },
      {
        messageId: "<item-3@mail.example>",
        ok: false,
        error: { kind: "invalid_output", message: expect.any(String) },
      },
    ]);
    expect(result.usage).toEqual([
      { task: "classify.v1", inputTokens: 101, outputTokens: 11 },
      { task: "classify.v1", inputTokens: 102, outputTokens: 12 },
    ]);
    expect(events).toEqual([
      { event: "ai.output_invalid", taskId: "classify.v1", reason: "schema", items: 2, attempt: 1 },
      { event: "ai.output_invalid", taskId: "classify.v1", reason: "schema", items: 1, attempt: 2 },
    ]);
  });

  it("makes no retry with maxCalls 1: the failed items come back not_retried", async () => {
    const { client, prompts, events } = clientWith([classified([[1, "offer"]])]);
    const result = await client.classify([item(1), item(2)], { maxCalls: 1 });
    expect(prompts).toHaveLength(1);
    expect(result.items[1]).toEqual({
      messageId: "<item-2@mail.example>",
      ok: false,
      error: { kind: "not_retried", message: expect.any(String) },
    });
    expect(result.usage).toHaveLength(1);
    expect(events).toEqual([
      {
        event: "ai.output_invalid",
        taskId: "classify.v1",
        reason: "missing",
        items: 1,
        attempt: 1,
      },
    ]);
  });

  it("never patches an answer up: text that isn't JSON fails every item", async () => {
    const { client, events } = clientWith(["Sure! Item 1 is an offer.", "still not JSON"]);
    const result = await client.classify([item(1)]);
    expect(result.items).toEqual([
      {
        messageId: "<item-1@mail.example>",
        ok: false,
        error: { kind: "invalid_output", message: expect.any(String) },
      },
    ]);
    expect(events.map((e) => e.reason)).toEqual(["parse", "parse"]);
  });

  it("ignores answers for Message-IDs it didn't ask about", async () => {
    const { client } = clientWith([
      JSON.stringify({
        items: [
          { messageId: "<forged@evil.example>", category: "offer" },
          { messageId: "<item-1@mail.example>", category: "not_job" },
        ],
      }),
    ]);
    const result = await client.classify([item(1)]);
    expect(result.items).toEqual([
      { messageId: "<item-1@mail.example>", ok: true, data: { category: "not_job" } },
    ]);
  });

  it("validates prefs per item against PreferencesSchema", async () => {
    const { client } = clientWith([
      JSON.stringify({
        items: [
          { messageId: "<item-1@mail.example>", preferences: { contracts: ["B2B"] } },
          { messageId: "<item-2@mail.example>", preferences: { min_pay: "lots" } },
        ],
      }),
      JSON.stringify({ items: [] }),
    ]);
    const result = await client.prefs([item(1, { folder: "sent" }), item(2, { folder: "sent" })]);
    expect(result.items.map((r) => r.ok)).toEqual([true, false]);
    expect(result.items[0]).toMatchObject({ data: { preferences: { contracts: ["B2B"] } } });
    expect(result.usage.map((u) => u.task)).toEqual(["prefs.v1", "prefs.v1"]);
  });

  it("makes no call for an empty batch", async () => {
    const { client, prompts } = clientWith([]);
    expect(await client.classify([])).toEqual({ items: [], usage: [] });
    expect(prompts).toEqual([]);
  });
});

describe("single tasks", () => {
  const facts = {
    title: "Backend Engineer",
    company: null,
    agency: null,
    places: [],
    workMode: null,
    remoteScope: null,
    timeZones: null,
    pay: null,
    contract: null,
    seniority: null,
    workPermit: null,
    skills: [],
    languages: [],
    applyUrl: null,
    extra: {},
  };
  /** The same facts as the model writes them: `extra` as a list of {key, value}. */
  const answered = { ...facts, extra: [{ key: "start", value: "November" }] };

  it("retries an invalid extraction once and reports it without the model's output", async () => {
    const { client, prompts, events } = clientWith([
      JSON.stringify({ messageId: "<item-1@mail.example>", roles: [{ title: 42 }] }),
      JSON.stringify({ messageId: "<item-1@mail.example>", roles: [answered] }),
    ]);
    const result = await client.extract(item(1));
    expect(result).toEqual({
      ok: true,
      data: {
        messageId: "<item-1@mail.example>",
        roles: [{ ...facts, extra: { start: "November" } }],
      },
      usage: [
        { task: "extract.v1", inputTokens: 101, outputTokens: 11 },
        { task: "extract.v1", inputTokens: 102, outputTokens: 12 },
      ],
    });
    expect(prompts[1]).toBe(prompts[0]);
    expect(events).toEqual([
      { event: "ai.output_invalid", taskId: "extract.v1", reason: "schema", items: 1, attempt: 1 },
    ]);
  });

  it("doesn't take facts about another message", async () => {
    const answer = JSON.stringify({ messageId: "<other@mail.example>", roles: [answered] });
    const { client } = clientWith([answer, answer]);
    const result = await client.extract(item(1));
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_output" } });
    expect(result.usage).toHaveLength(2);
  });

  it("gives up without a retry when maxCalls is 1", async () => {
    const { client, prompts } = clientWith(["{}"]);
    const result = await client.extract(item(1), { maxCalls: 1 });
    expect(result).toMatchObject({ ok: false, error: { kind: "not_retried" } });
    expect(prompts).toHaveLength(1);
  });

  it("takes exactly an IntakeExtraInput and returns up to five questions", async () => {
    const input: IntakeExtraInput = {
      items: [item(1)],
      answers: [{ key: "contracts", value: ["B2B"], confidence: "high" }],
    };
    const questions = [
      {
        slug: "accepts-b2b",
        label: "Do you accept B2B contracts?",
        options: ["Yes", "No"],
        evidence: [],
      },
    ];
    const { client, prompts } = clientWith([JSON.stringify({ questions })]);
    const result = await client.intake(input);
    expect(result).toMatchObject({ ok: true, data: { questions } });
    expect(prompts[0]).toContain(
      '=== summary ===\n| contracts [high]: ["B2B"]\n=== end summary ===',
    );
  });

  it("tests with one call and no retry", async () => {
    const { client, prompts, events } = clientWith(['{"ok": false}', '{"ok": true}']);
    const result = await client.test();
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_output" } });
    expect(prompts).toEqual(["task: ai.test.v1\nitems: 0\n\n"]);
    expect(events).toHaveLength(1);
  });
});

describe("models per task", () => {
  it("runs each task on its own model", async () => {
    const used: AiTask[] = [];
    const answers: Record<AiTask, string> = {
      classify: classified([[1, "offer"]]),
      extract: JSON.stringify({ messageId: "<item-1@mail.example>", roles: [] }),
      prefs: JSON.stringify({ items: [{ messageId: "<item-1@mail.example>", preferences: {} }] }),
      intake: JSON.stringify({ questions: [] }),
    };
    const client = clientFromModels((task) => {
      used.push(task);
      return { model: scripted([answers[task]]).model };
    });
    await client.classify([item(1)]);
    await client.extract(item(1));
    await client.prefs([item(1)]);
    await client.intake({ items: [], answers: [] });
    expect(used).toEqual(["classify", "extract", "prefs", "intake"]);
  });
});

describe("ai.output_invalid (F3.4)", () => {
  it("carries only the task, the reason, the count and the attempt: never mail or output", async () => {
    const output = '{"items":[{"messageId":"<item-1@mail.example>","category":"MODEL-OUTPUT-X"}]}';
    const { client, events } = clientWith([output, output]);
    await client.classify([item(1), item(2)]);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(["attempt", "event", "items", "reason", "taskId"]);
    }
    const logged = JSON.stringify(events);
    for (const leak of [
      "MODEL-OUTPUT-X",
      "SECRET-SUBJECT",
      "agency.example",
      "mail.example",
      "@",
    ]) {
      expect(logged).not.toContain(leak);
    }
  });
});
