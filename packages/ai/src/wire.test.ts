import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { TASK_IDS, TASK_OUTPUT_SCHEMAS, type TaskId } from "@jobfilly/schema";
import { generateText, Output } from "ai";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

// The <taskId>.request.json samples in e2e/fixtures/wire are the body the installed AI SDK sends
// through the openai-compatible provider: here the SDK is driven with each sample's two messages,
// the task's output schema and its name, and the body it posts is captured with a fake fetch. So
// the transport fields (no `stream`, `json_schema.strict`, the draft-07 schema with every object
// closed) come from the SDK, not from hand-writing, and an SDK upgrade that changes them fails
// here. The connect slice's client must send these same bodies; its tests read the same samples.

const WIRE = fileURLToPath(new URL("../../../e2e/fixtures/wire/", import.meta.url));
const read = (taskId: TaskId, kind: "request" | "response"): string =>
  readFileSync(`${WIRE}${taskId}.${kind}.json`, "utf8");

type Request = { messages: [{ content: string }, { content: string }] };

async function sdkRequest(taskId: TaskId): Promise<unknown> {
  const sample = JSON.parse(read(taskId, "request")) as Request;
  // One task's schema at a time; the union of all five is too wide for Output.object's typing.
  const schema: ZodType = TASK_OUTPUT_SCHEMAS[taskId];
  let sent: unknown;
  const provider = createOpenAICompatible({
    name: "wire",
    baseURL: "http://fake-ai.invalid/v1",
    apiKey: "wire-test",
    supportsStructuredOutputs: true,
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(read(taskId, "response"), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  await generateText({
    model: provider("fixture-model"),
    system: sample.messages[0].content,
    prompt: sample.messages[1].content,
    output: Output.object({
      schema,
      name: taskId.replaceAll(".", "_"),
    }),
  });
  return sent;
}

describe.each(TASK_IDS)("the %s request sample", (taskId) => {
  it("is the body the AI SDK sends for its messages and output schema", async () => {
    expect(await sdkRequest(taskId)).toEqual(JSON.parse(read(taskId, "request")));
  });
});
