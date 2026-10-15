import { z } from "zod";
import { ScanProgressSchema } from "./scan";

/**
 * Live updates sent over SSE to every open browser of a workspace (GET
 * /api/workspaces/:workspaceId/events). The SSE `event` field is the type, `data` the JSON body.
 */
export const LiveEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scan.progress"), data: ScanProgressSchema }),
  z.object({
    type: z.literal("scan.stopped"),
    data: ScanProgressSchema.extend({ stopMessage: z.string() }),
  }),
  /** Message rows changed (analysed or corrected); the list refetches. */
  z.object({
    type: z.literal("messages.updated"),
    data: z.object({ messageIds: z.array(z.string()).optional() }),
  }),
  /** The intake proposal, an answer or the extra questions changed. */
  z.object({ type: z.literal("intake.updated"), data: z.object({}) }),
  /** Members, invites, the mailbox or the AI settings changed. */
  z.object({ type: z.literal("workspace.updated"), data: z.object({}) }),
]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;

/**
 * What one replica sends the others through Postgres NOTIFY: a live event and the workspace whose
 * streams get it. Every replica validates it on receipt.
 */
export const LiveEnvelopeSchema = z.object({ workspaceId: z.uuid(), event: LiveEventSchema });
export type LiveEnvelope = z.infer<typeof LiveEnvelopeSchema>;
export type LiveEventType = LiveEvent["type"];

export const LIVE_EVENT_TYPES = [
  "scan.progress",
  "scan.stopped",
  "messages.updated",
  "intake.updated",
  "workspace.updated",
] as const satisfies readonly LiveEventType[];
