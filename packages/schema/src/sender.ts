import { z } from "zod";
import { IsoDateTimeSchema } from "./common";

// The sender check (F5): a verdict with its reasons, worded as an estimate. A lookup that failed
// leaves the check incomplete, never "looks fine" (F5.3); an editor's mark is named in it (F5.4).

export const SenderVerdictSchema = z.enum(["looks_fine", "caution", "high_risk"]);
export type SenderVerdict = z.infer<typeof SenderVerdictSchema>;

export const SenderMarkSchema = z.enum(["trusted", "blocked"]);
export type SenderMark = z.infer<typeof SenderMarkSchema>;

/**
 * One reason of a check. `signal` is a stable snake_case name of what was found (asks_for_fee,
 * asks_for_id, chat_only, free_mail_company, sender_mismatch, young_domain, no_mx,
 * lookup_failed, message_gone, check_failed, marked_trusted, marked_blocked…); `reason` is its
 * plain words.
 */
export const SenderReasonSchema = z.object({
  signal: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  reason: z.string(),
});
export type SenderReason = z.infer<typeof SenderReasonSchema>;

/**
 * The signal of a check made without the message text because the message is no longer in the
 * mailbox under its stored reference. Such a check is incomplete and never better than caution;
 * it is checked again once a scan or sync sees the message again (packages/db saveEnvelopes).
 */
export const MESSAGE_GONE_SIGNAL = "message_gone";

/**
 * The signal of a check whose sender stage failed (the mailbox couldn't be reached, a lookup or
 * the model threw): the check is incomplete, keeps what an earlier check found (a looks-fine
 * verdict drops to caution, never better; an editor's mark stays) and is tried again by a later
 * sweep. The reply waits for a real check meanwhile.
 */
export const CHECK_FAILED_SIGNAL = "check_failed";

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
 * The signal of a check whose domain lookup (RDAP or DNS) failed. Such a check is incomplete; it
 * is checked again once the failure has left the lookup cache (apps/server senders/retry).
 */
export const LOOKUP_FAILED_SIGNAL = "lookup_failed";

/**
 * An RDAP domain answer (RFC 9083) as JOBFILLY_RDAP_URL returns it over HTTP: only its events
 * are read, for the registration date; everything else in it passes through unread.
 */
export const RdapDomainAnswerSchema = z.looseObject({
  events: z.array(z.looseObject({ eventAction: z.string(), eventDate: z.string() })).optional(),
});
export type RdapDomainAnswer = z.infer<typeof RdapDomainAnswerSchema>;

/** A domain's RDAP lookup as the workspace's lookup cache keeps it: its registration date. */
export const RdapLookupResultSchema = z.object({ registeredAt: IsoDateTimeSchema.nullable() });
export type RdapLookupResult = z.infer<typeof RdapLookupResultSchema>;

/** A domain's MX lookup as the cache keeps it: the mail servers' host names ([] for none). */
export const MxLookupResultSchema = z.array(z.string());
export type MxLookupResult = z.infer<typeof MxLookupResultSchema>;

/** What a mark is on: one address, or every address of a domain. */
export const SenderMarkScopeSchema = z.enum(["address", "domain"]);
export type SenderMarkScope = z.infer<typeof SenderMarkScopeSchema>;

/** An address or a domain as a mark keys it: trimmed, lower case. */
const MarkValueSchema = z.string().trim().toLowerCase().min(1).max(320);

/**
 * A mark as it applies to a sender: trusted or blocked, on one address or a whole domain, with
 * the address or domain it is on. The sender check names it (packages/core) and packages/db reads
 * it back by the sender.
 */
export const AppliedMarkSchema = z.object({
  scope: SenderMarkScopeSchema,
  value: MarkValueSchema,
  mark: SenderMarkSchema,
});
export type AppliedMark = z.infer<typeof AppliedMarkSchema>;

/**
 * PUT /senders/marks: mark an address or a whole domain trusted or blocked, or clear the mark
 * (null). Kept across syncs; the affected senders' checks are re-done. Clearing a mark that
 * isn't there is a 404, so a clear never looks done while another mark still applies. An address
 * has an '@' with a dotted domain after it; a domain has no '@' and a dot.
 */
export const SenderMarkInputSchema = z
  .object({
    scope: SenderMarkScopeSchema,
    value: MarkValueSchema,
    mark: SenderMarkSchema.nullable(),
  })
  .superRefine(({ scope, value }, ctx) => {
    const at = value.lastIndexOf("@");
    if (scope === "address" && !(at > 0 && value.slice(at + 1).includes("."))) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Give an email address" });
    }
    if (scope === "domain" && !(at < 0 && value.includes("."))) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Give a domain such as example.com",
      });
    }
  });
export type SenderMarkInput = z.infer<typeof SenderMarkInputSchema>;

/**
 * The answer of GET /senders/messages/:messageId/mark: the mark that applies to that message's
 * sender now (its address's own, or else its whole domain's) with what it is on, or null. Keyed by
 * the message, so no address is ever in a URL. A check names the mark it was made with; this
 * is the mark as it stands, so the UI clears the one that applies (F5.4).
 */
export const AppliedSenderMarkSchema = z.object({ applied: AppliedMarkSchema.nullable() });
export type AppliedSenderMark = z.infer<typeof AppliedSenderMarkSchema>;

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

/** A lower-case word, as the language word lists hold them. */
const LowerCaseWordSchema = z
  .string()
  .min(1)
  .refine((w) => w === w.toLowerCase(), "a lower-case word");

/**
 * packages/core/src/sender/data/language-words.json: per language (ISO 639-1), common function
 * words (to tell a message's language) and negations (so "never pay a fee" in a job board's
 * footer isn't read as asking for one), lower case. Data, not code: a language is added without
 * a code change.
 */
export const LanguageWordsFileSchema = z.object({
  version: z.literal(1),
  languages: z.record(
    z.string().regex(/^[a-z]{2}$/, "an ISO 639-1 code"),
    z.object({ common: z.array(LowerCaseWordSchema), negations: z.array(LowerCaseWordSchema) }),
  ),
});
export type LanguageWordsFile = z.infer<typeof LanguageWordsFileSchema>;
