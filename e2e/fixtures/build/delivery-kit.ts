import type { DraftAnswer, JobFacts } from "../format.ts";
import type { DeliveryRole } from "./deliveries.ts";
import type { Lang } from "./recruiters.ts";
import type { HardConflict } from "./spec.ts";

// Small builders for the delivered mail's roles, shared by MVP 2's deliveries (deliveries.ts) and
// MVP 3's (germany.ts, pipeline.ts). Only types come from deliveries.ts, so its list can import
// MVP 3's without a cycle.

/** A draft.v1 answer replying to `subject`, with no questions unless `extra` gives some. */
export const reply = (
  subject: string,
  body: string,
  language: Lang,
  usedEntries: string[],
  extra: Partial<DraftAnswer> = {},
): DraftAnswer => ({
  subject: `Re: ${subject}`,
  body,
  language,
  usedEntries,
  attachCv: false,
  questions: [],
  ...extra,
});

/** A role a hard conflict caps (F4.2), with no draft. */
export const capped = (hardConflicts: HardConflict[], facts: JobFacts): DeliveryRole => ({
  facts,
  hardConflicts,
  fit: "capped",
  needs: [],
  draft: false,
  answers: {},
});
