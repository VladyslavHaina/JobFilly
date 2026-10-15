import type { Liveness } from "@jobfilly/schema";
import { Hono } from "hono";
import type { AppEnv } from "../access/env";
import type { AppDeps } from "../deps";

// /api/health/live: the process runs. /api/health/ready: the database is reachable and
// migrated, and shutdown hasn't begun; otherwise 503 with the reason (F7.2).
export function healthRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/live", (c) => c.json({ status: "ok" } satisfies Liveness))
    .get("/ready", async (c) => {
      const readiness = await deps.health.check();
      return c.json(readiness, readiness.status === "ready" ? 200 : 503);
    });
}
