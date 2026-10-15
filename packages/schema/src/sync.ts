import { z } from "zod";
import { IsoDateTimeSchema } from "./common";

// Continuous sync (F1): the mailbox status the inbox header shows, and the model usage per day
// Settings › AI shows.

/**
 * The state of a mailbox's sync (F1.4): `ok` after a sync that worked ("Synced 2 minutes ago"),
 * `failing` since the first failed sync in a row ("Can't reach the mail server since 10:42"),
 * `never` before the first sync. `message` is plain words, never the server's own text.
 */
export const MailboxSyncStatusSchema = z.object({
  state: z.enum(["ok", "failing", "never"]),
  lastSyncedAt: IsoDateTimeSchema.nullable(),
  failingSince: IsoDateTimeSchema.nullable(),
  message: z.string().nullable(),
});
export type MailboxSyncStatus = z.infer<typeof MailboxSyncStatusSchema>;

/** The status of a mailbox that has never synced. */
export const NEVER_SYNCED: MailboxSyncStatus = {
  state: "never",
  lastSyncedAt: null,
  failingSince: null,
  message: null,
};

/** Model calls and tokens of one day (UTC) for the workspace (F1.5). `day` is YYYY-MM-DD. */
export const AiUsageDaySchema = z.object({
  day: z.iso.date(),
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type AiUsageDay = z.infer<typeof AiUsageDaySchema>;

/** GET /ai/usage: the workspace's usage per day, newest first. */
export const AiUsageListSchema = z.object({ items: z.array(AiUsageDaySchema) });
export type AiUsageList = z.infer<typeof AiUsageListSchema>;
