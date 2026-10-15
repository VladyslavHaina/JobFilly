import { z } from "zod";

/** GET /api/health/live: the process is up. */
export const LivenessSchema = z.object({ status: z.literal("ok") });
export type Liveness = z.infer<typeof LivenessSchema>;

/**
 * GET /api/health/ready: 200 with "ready" when the database is reachable and migrated, otherwise
 * 503 with the reason.
 */
export const ReadinessSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready") }),
  z.object({
    status: z.literal("not_ready"),
    reason: z.enum(["database_unreachable", "migrations_missing", "shutting_down"]),
  }),
]);
export type Readiness = z.infer<typeof ReadinessSchema>;
