import type { Context } from "hono";

// The answer of a route the MVP 3 foundation registered ahead of the slice that builds it. Each
// slice replaces its stubs; this file goes once the last one has (knip reports it unused then).

export const notImplemented = (c: Context) =>
  c.json({ error: "not_implemented", message: "This part of JobFilly isn't built yet" }, 501);
