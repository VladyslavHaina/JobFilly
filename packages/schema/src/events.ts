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
  /** A CV was uploaded, read, re-tagged or deleted. */
  z.object({ type: z.literal("cvs.updated"), data: z.object({}) }),
  /** Drafts changed: created, saved to the mailbox, edited, discarded or failed. */
  z.object({
    type: z.literal("drafts.updated"),
    data: z.object({ messageIds: z.array(z.string()).optional() }),
  }),
  /** The decision inbox changed (a decision created, answered, dismissed). */
  z.object({ type: z.literal("decisions.updated"), data: z.object({}) }),
  /** A profile's entries, rules or history changed. */
  z.object({ type: z.literal("profiles.updated"), data: z.object({}) }),
  /** The assistant thread or a proposal changed. */
  z.object({ type: z.literal("assistant.updated"), data: z.object({}) }),
  /** A mailbox's sync status changed (synced, failing, recovered). */
  z.object({ type: z.literal("mailbox.updated"), data: z.object({}) }),
  /** MVP 3 (F5): a role's stage was set by hand (new mail moves stages with messages.updated). */
  z.object({ type: z.literal("pipeline.updated"), data: z.object({}) }),
  /** MVP 3 (F4): a send was scheduled, undone, sent or failed. */
  z.object({ type: z.literal("sends.updated"), data: z.object({ draftId: z.uuid() }) }),
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
  "cvs.updated",
  "drafts.updated",
  "decisions.updated",
  "profiles.updated",
  "assistant.updated",
  "mailbox.updated",
  "pipeline.updated",
  "sends.updated",
] as const satisfies readonly LiveEventType[];

/**
 * Who may no longer hold a live stream, sent through the same NOTIFY channel as the events so it
 * reaches every replica in order with them: a member removed from a workspace, or a session that
 * ended (sign-out, expiry, or replaced at sign-in). Each replica closes the matching streams.
 */
export const LiveAccessChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("member.removed"), workspaceId: z.uuid(), userId: z.uuid() }),
  z.object({ type: z.literal("session.ended"), sessionId: z.uuid() }),
]);
export type LiveAccessChange = z.infer<typeof LiveAccessChangeSchema>;

/** Anything on the live channel: an event for a workspace's streams, or an access change. */
export const LiveNotificationSchema = z.union([LiveEnvelopeSchema, LiveAccessChangeSchema]);
export type LiveNotification = z.infer<typeof LiveNotificationSchema>;
