import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiMailItemSchema,
  AnswerTaskInputSchema,
  AssistantAnswerSchema,
  AssistantTaskInputSchema,
  batchResultSchema,
  CategorySchema,
  CvReadInputSchema,
  DraftTaskInputSchema,
  FocusTaskInputSchema,
  IntakeExtraInputSchema,
  JobFactsSchema,
  MatchTaskInputSchema,
  PreferencesSchema,
  TASK_IDS,
  TASK_OUTPUT_SCHEMAS,
  type TaskId,
  taskResultSchema,
} from "./index";

// The wire contract between packages/ai and the fake AI is committed data in e2e/fixtures/wire
// (one input, request, response and output per task id). Here it is checked against the schemas
// it is built from, so a schema change that breaks the samples fails at once. The request samples
// are the body the AI SDK's openai-compatible provider sends (packages/ai/src/wire.test.ts pins
// them to the installed SDK): no `stream` field, `strict: true`, and the output schema's input
// side converted to JSON Schema draft-07 with every object closed. The output samples are what
// packages/ai returns: the parsed answers, with `extra` as a record again.

const WIRE = fileURLToPath(new URL("../../../e2e/fixtures/wire/", import.meta.url));
const read = (taskId: TaskId, kind: "input" | "request" | "response" | "output"): unknown =>
  JSON.parse(readFileSync(`${WIRE}${taskId}.${kind}.json`, "utf8"));

const INPUTS: Record<TaskId, z.ZodType> = {
  "classify.v1": z.array(AiMailItemSchema),
  "extract.v1": AiMailItemSchema,
  "prefs.v1": z.array(AiMailItemSchema),
  "intake.v1": IntakeExtraInputSchema,
  "ai.test.v1": z.null(),
  "cv.v1": CvReadInputSchema,
  "match.v1": MatchTaskInputSchema,
  "draft.v1": DraftTaskInputSchema,
  "assistant.v1": AssistantTaskInputSchema,
  "focus.v1": FocusTaskInputSchema,
  "answer.v1": AnswerTaskInputSchema,
};

const OUTPUTS: Record<TaskId, z.ZodType> = {
  "classify.v1": batchResultSchema(z.object({ category: CategorySchema })),
  "extract.v1": taskResultSchema(
    z.object({ messageId: z.string(), roles: z.array(JobFactsSchema) }),
  ),
  "prefs.v1": batchResultSchema(z.object({ preferences: PreferencesSchema })),
  "intake.v1": taskResultSchema(TASK_OUTPUT_SCHEMAS["intake.v1"]),
  "ai.test.v1": taskResultSchema(TASK_OUTPUT_SCHEMAS["ai.test.v1"]),
  "cv.v1": taskResultSchema(TASK_OUTPUT_SCHEMAS["cv.v1"]),
  "match.v1": taskResultSchema(TASK_OUTPUT_SCHEMAS["match.v1"]),
  "draft.v1": taskResultSchema(TASK_OUTPUT_SCHEMAS["draft.v1"]),
  // The provider writes AssistantRequestSchema's flat changes; packages/ai returns Changes.
  "assistant.v1": taskResultSchema(AssistantAnswerSchema),
  "focus.v1": taskResultSchema(TASK_OUTPUT_SCHEMAS["focus.v1"]),
  "answer.v1": taskResultSchema(TASK_OUTPUT_SCHEMAS["answer.v1"]),
};

/**
 * The JSON Schema the AI SDK sends for an output schema: its input side, what the model writes
 * (`extra` as a list), with every object closed.
 */
const sentSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    override: ({ jsonSchema }) => {
      if (jsonSchema.type === "object" && jsonSchema.additionalProperties === undefined) {
        jsonSchema.additionalProperties = false;
      }
    },
  });

const RequestSchema = z.strictObject({
  model: z.literal("fixture-model"),
  messages: z.tuple([
    z.object({ role: z.literal("system"), content: z.string() }),
    z.object({ role: z.literal("user"), content: z.string() }),
  ]),
  response_format: z.strictObject({
    type: z.literal("json_schema"),
    json_schema: z.strictObject({
      schema: z.record(z.string(), z.unknown()),
      strict: z.literal(true),
      name: z.string(),
    }),
  }),
});

const ResponseSchema = z.object({
  model: z.string(),
  choices: z.tuple([
    z.object({
      index: z.literal(0),
      message: z.object({ role: z.literal("assistant"), content: z.string() }),
      finish_reason: z.literal("stop"),
    }),
  ]),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

describe.each(TASK_IDS)("the %s wire sample", (taskId) => {
  it("has an input of the packages/ai argument's shape", () => {
    expect(INPUTS[taskId].safeParse(read(taskId, "input")).success).toBe(true);
  });

  it("asks for the task's draft-07 output schema by name, in strict json_schema mode", () => {
    const request = RequestSchema.parse(read(taskId, "request"));
    expect(request.response_format.json_schema.name).toBe(taskId.replaceAll(".", "_"));
    expect(request.response_format.json_schema.schema).toEqual(
      sentSchema(TASK_OUTPUT_SCHEMAS[taskId]),
    );
    expect(request.messages[0].content.split("\n")[0]).toBe(`task: ${taskId}`);
    expect(request.messages[1].content.split("\n")[0]).toBe(`task: ${taskId}`);
  });

  it("answers with JSON content valid against the output schema", () => {
    const response = ResponseSchema.parse(read(taskId, "response"));
    const answer = JSON.parse(response.choices[0].message.content);
    expect(TASK_OUTPUT_SCHEMAS[taskId].safeParse(answer).success).toBe(true);
  });

  it("turns into the output packages/ai returns, with the call's usage", () => {
    const output = OUTPUTS[taskId].parse(read(taskId, "output")) as {
      usage: { task: string; inputTokens: number; outputTokens: number }[];
    };
    const { usage } = ResponseSchema.parse(read(taskId, "response"));
    expect(output.usage).toEqual([
      { task: taskId, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens },
    ]);
  });
});

/**
 * How big a JSON Schema is for a provider's grammar: its properties, union branches, enum and
 * const values and patterns, counted through every level.
 */
function schemaSize(node: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, item) => n + schemaSize(item), 0);
  if (typeof node !== "object" || node === null) return 0;
  const s = node as Record<string, unknown>;
  const own =
    Object.keys((s.properties as object | undefined) ?? {}).length +
    ((s.anyOf as unknown[] | undefined)?.length ?? 0) +
    ((s.enum as unknown[] | undefined)?.length ?? 0) +
    (s.const !== undefined ? 1 : 0) +
    (s.pattern !== undefined ? 1 : 0);
  return Object.values(s).reduce((n: number, value) => n + schemaSize(value), own);
}

// Anthropic refuses an output schema whose compiled grammar is too large (HTTP 400
// invalid_request_error) before it generates anything. assistant.v1's nested Change union
// (206 by this count) was refused; the largest it accepted, extract.v1's, is 60.
const MAX_SCHEMA_SIZE = 100;

describe.each(TASK_IDS)("the %s output schema", (taskId) => {
  it(`is small enough for every provider's grammar (at most ${MAX_SCHEMA_SIZE})`, () => {
    expect(schemaSize(sentSchema(TASK_OUTPUT_SCHEMAS[taskId]))).toBeLessThanOrEqual(
      MAX_SCHEMA_SIZE,
    );
  });
});
