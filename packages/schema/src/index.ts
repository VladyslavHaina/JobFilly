import { z } from "zod";

// The shared contract. Every API payload, every AI structured output and the
// profile format are defined here once and imported everywhere else.

export const HealthSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;
