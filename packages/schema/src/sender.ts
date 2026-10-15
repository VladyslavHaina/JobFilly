import { z } from "zod";

// The sender check (F5): a verdict with its reasons, worded as an estimate. A lookup that failed
// leaves the check incomplete, never "looks fine" (F5.3); an editor's mark is named in it (F5.4).

export const SenderVerdictSchema = z.enum(["looks_fine", "caution", "high_risk"]);
export type SenderVerdict = z.infer<typeof SenderVerdictSchema>;

export const SenderMarkSchema = z.enum(["trusted", "blocked"]);
export type SenderMark = z.infer<typeof SenderMarkSchema>;

/**
 * One reason of a check. `signal` is a stable snake_case name of what was found (asks_for_fee,
 * asks_for_id, chat_only, free_mail_company, sender_mismatch, young_domain, no_mx,
 * lookup_failed, marked_trusted, marked_blocked…); `reason` is its plain words.
 */
export const SenderReasonSchema = z.object({
  signal: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  reason: z.string(),
});
export type SenderReason = z.infer<typeof SenderReasonSchema>;

export const SenderCheckSchema = z.object({
  verdict: SenderVerdictSchema,
  /** False when a lookup failed or a signal couldn't be read: the verdict is then never better
   * than caution. */
  complete: z.boolean(),
  reasons: z.array(SenderReasonSchema),
  mark: SenderMarkSchema.nullable(),
});
export type SenderCheck = z.infer<typeof SenderCheckSchema>;

/**
 * PUT /senders/marks: mark an address or a whole domain trusted or blocked, or clear the mark
 * (null). Kept across syncs; the affected senders' checks are re-done.
 */
export const SenderMarkInputSchema = z.object({
  scope: z.enum(["address", "domain"]),
  value: z.string().trim().toLowerCase().min(1).max(320),
  mark: SenderMarkSchema.nullable(),
});
export type SenderMarkInput = z.infer<typeof SenderMarkInputSchema>;

/** A lowercase hostname, as the sender data files list them. */
const HostnameSchema = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, "a lowercase hostname");

/**
 * packages/core/src/sender/data/free-mail-domains.json: the free-mail providers' domains, so a
 * company recruiter writing from one can be noticed (F5). Data, not code: the list is market-
 * specific and grows without a code change.
 */
export const FreeMailDomainsFileSchema = z.object({
  version: z.literal(1),
  domains: z.array(HostnameSchema),
});
export type FreeMailDomainsFile = z.infer<typeof FreeMailDomainsFileSchema>;

/** The message signals the phrase lists find (F5). */
export const MESSAGE_SIGNALS = ["asks_for_fee", "asks_for_id", "chat_only"] as const;
export const MessageSignalSchema = z.enum(MESSAGE_SIGNALS);
export type MessageSignal = z.infer<typeof MessageSignalSchema>;

/**
 * packages/core/src/sender/data/message-signals.json: per language (ISO 639-1), the phrases that
 * show each signal in a message body, lower case. A message in a language without a list can't
 * be read for signals, so its check is incomplete, never "looks fine" (TBD-176).
 */
export const MessageSignalsFileSchema = z.object({
  version: z.literal(1),
  languages: z.record(
    z.string().regex(/^[a-z]{2}$/, "an ISO 639-1 code"),
    z.object({
      asks_for_fee: z.array(z.string().min(1)),
      asks_for_id: z.array(z.string().min(1)),
      chat_only: z.array(z.string().min(1)),
    }),
  ),
});
export type MessageSignalsFile = z.infer<typeof MessageSignalsFileSchema>;
