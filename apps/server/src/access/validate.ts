import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

// Request validation for every route: the JSON body, the query or the path params are parsed with
// a schema from @jobfilly/schema, and a bad request gets 400 with the first problem in plain
// words. Read the result with c.req.valid("json") (or "query", "param").

function validator<Target extends keyof ValidationTargets, T extends ZodType>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "The request is not valid";
      return c.json({ error: "invalid", message }, 400);
    }
  });
}

export const validJson = <T extends ZodType>(schema: T) => validator("json", schema);
export const validQuery = <T extends ZodType>(schema: T) => validator("query", schema);
export const validParams = <T extends ZodType>(schema: T) => validator("param", schema);
