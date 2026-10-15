import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { type AnswerStore, answerFor } from "./answers.ts";
import { parsePrompt } from "./prompt.ts";

// An OpenAI-compatible stub: POST /v1/chat/completions, non-streaming, answering from canned
// fixtures. Every answer waits `delayMs` so runs last long enough for mid-run steps; ai.test.v1
// also waits `slowTestMs`, which lets S11 hold a Settings › AI Test request open. A prompt with
// no answer gets HTTP 500 and a log line saying why.

export interface FakeAiOptions {
  store: AnswerStore;
  delayMs: number;
  slowTestMs: number;
  log: (line: Record<string, unknown>) => void;
  /** Seconds since the epoch, for the response's `created`. */
  now?: () => number;
  /** How a delay is waited out (tests record it instead). */
  wait?: (ms: number) => Promise<unknown>;
}

interface Reply {
  status: number;
  body: unknown;
  taskId?: string;
}

const tokens = (text: string) => Math.ceil(text.length / 4);

/** The response to one chat-completions request body. */
export function respond(
  body: unknown,
  options: Omit<FakeAiOptions, "delayMs" | "slowTestMs">,
): Reply {
  const prompt = parsePrompt(body);
  if ("error" in prompt) {
    options.log({ level: "warn", event: "fake_ai.bad_request", reason: prompt.error });
    return {
      status: 400,
      body: { error: { message: prompt.error, type: "invalid_request_error" } },
    };
  }
  const answer = answerFor(options.store, prompt);
  if (!answer.ok) {
    options.log({
      level: "error",
      event: "fake_ai.no_answer",
      taskId: prompt.taskId,
      messageIds: prompt.messageIds,
      reason: answer.reason,
    });
    return {
      status: 500,
      taskId: prompt.taskId,
      body: { error: { message: `fake AI has no answer: ${answer.reason}`, type: "server_error" } },
    };
  }
  const content = JSON.stringify(answer.content);
  const messages = (body as { messages: { content?: unknown }[] }).messages;
  const promptTokens = tokens(messages.map((m) => JSON.stringify(m.content ?? "")).join(""));
  const completionTokens = tokens(content);
  options.log({
    level: "info",
    event: "fake_ai.answered",
    taskId: prompt.taskId,
    items: prompt.messageIds.length,
  });
  return {
    status: 200,
    taskId: prompt.taskId,
    body: {
      id: `chatcmpl-fake-${prompt.taskId.replace(/\W/g, "-")}`,
      object: "chat.completion",
      created: (options.now ?? (() => Math.floor(Date.now() / 1000)))(),
      model: String((body as { model?: unknown }).model ?? "fake-model"),
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    },
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createFakeAi(options: FakeAiOptions): Server {
  return createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true });
    if (req.method !== "POST" || path !== "/v1/chat/completions") {
      return send(res, 404, { error: { message: `no route for ${req.method} ${path}` } });
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      options.log({ level: "warn", event: "fake_ai.bad_request", reason: "the body is not JSON" });
      return send(res, 400, { error: { message: "the body is not JSON" } });
    }
    const reply = respond(body, options);
    const wait = options.wait ?? sleep;
    await wait(options.delayMs + (reply.taskId === "ai.test.v1" ? options.slowTestMs : 0));
    send(res, reply.status, reply.body);
  });
}
