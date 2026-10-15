import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiMailItemSchema,
  batchResultSchema,
  CategorySchema,
  IntakeExtraInputSchema,
  JobFactsSchema,
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
};

const OUTPUTS: Record<TaskId, z.ZodType> = {
  "classify.v1": batchResultSchema(z.object({ category: CategorySchema })),
  "extract.v1": taskResultSchema(
    z.object({ messageId: z.string(), roles: z.array(JobFactsSchema) }),
  ),
  "prefs.v1": batchResultSchema(z.object({ preferences: PreferencesSchema })),
  "intake.v1": taskResultSchema(TASK_OUTPUT_SCHEMAS["intake.v1"]),
  "ai.test.v1": taskResultSchema(TASK_OUTPUT_SCHEMAS["ai.test.v1"]),
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
