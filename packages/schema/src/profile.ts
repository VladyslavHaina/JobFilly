import { z } from "zod";
import {
  CountryCodeSchema,
  CurrencyCodeSchema,
  IsoDateTimeSchema,
  PayPeriodSchema,
  TextSchema,
  TimeZoneRangeSchema,
} from "./common";
import { ExtraAnswerSchema, JobFactsSchema } from "./facts";
import { CategorySchema } from "./messages";

/** The core questions of the intake form (F6), in the order the form asks them. */
export const CORE_PROFILE_KEYS = [
  "target_roles",
  "seniority",
  "places",
  "remote",
  "contracts",
  "min_pay",
  "languages",
  "work_permits",
  "reply_to",
  "deal_breakers",
] as const;
export const CoreProfileKeySchema = z.enum(CORE_PROFILE_KEYS);
export type CoreProfileKey = z.infer<typeof CoreProfileKeySchema>;

/** The form's label for each core question. */
export const CORE_PROFILE_LABELS: Record<CoreProfileKey, string> = {
  target_roles: "Roles you're looking for",
  seniority: "Seniority",
  places: "Places you'd work onsite or hybrid",
  remote: "Remote work",
  contracts: "Contracts",
  min_pay: "Minimum pay",
  languages: "Working languages",
  work_permits: "Work permits",
  reply_to: "Mail that should get a reply",
  deal_breakers: "Deal-breakers",
};

/** A short lowercase slug naming an extra question. */
export const ExtraSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "a lowercase slug");

/** A core key, or "extra.<slug>" for one of the up to five extra questions. */
export const ProfileKeySchema = z.union([
  CoreProfileKeySchema,
  z.string().regex(/^extra\.[a-z0-9][a-z0-9_-]{0,63}$/, "extra.<slug>"),
]);
export type ProfileKey = z.infer<typeof ProfileKeySchema>;

export function isExtraKey(key: string): key is `extra.${string}` {
  return key.startsWith("extra.");
}

// One value schema per core key. Every value is a list, so an empty answer is [].
const WordsSchema = z.array(TextSchema);
export const ProfilePlaceSchema = z.object({
  country: CountryCodeSchema,
  city: TextSchema.nullable(),
  mode: z.enum(["onsite", "hybrid"]),
});
export const RemotePreferenceSchema = z.object({
  /** The remote scope as worded ("EU", "Europe time zones"). */
  scope: TextSchema,
  timeZones: TimeZoneRangeSchema.nullable(),
});
export const MinPaySchema = z.object({
  amount: z.number().nonnegative(),
  currency: CurrencyCodeSchema,
  period: PayPeriodSchema,
  asWritten: TextSchema,
});
export const WorkPermitSchema = z.object({
  country: CountryCodeSchema.nullable(),
  text: TextSchema,
});

export const PROFILE_VALUE_SCHEMAS = {
  target_roles: WordsSchema,
  seniority: WordsSchema,
  places: z.array(ProfilePlaceSchema),
  remote: z.array(RemotePreferenceSchema),
  contracts: WordsSchema,
  min_pay: z.array(MinPaySchema),
  languages: WordsSchema,
  work_permits: z.array(WorkPermitSchema),
  reply_to: z.array(CategorySchema),
  deal_breakers: WordsSchema,
} as const satisfies Record<CoreProfileKey, z.ZodType>;

/** An extra question's answer: the option(s) chosen or the words typed. */
export const ExtraValueSchema = WordsSchema;

export type ProfileValues = {
  [K in CoreProfileKey]: z.infer<(typeof PROFILE_VALUE_SCHEMAS)[K]>;
};

/** Every shape a profile value can take; use profileValueSchema(key) to check one key's value. */
export const ProfileValueSchema = z.union([
  WordsSchema,
  z.array(ProfilePlaceSchema),
  z.array(RemotePreferenceSchema),
  z.array(MinPaySchema),
  z.array(WorkPermitSchema),
  z.array(CategorySchema),
]);
export type ProfileValue = z.infer<typeof ProfileValueSchema>;

/** The value schema for a key: its core schema, or the extra-answer schema. */
export function profileValueSchema(key: ProfileKey): z.ZodType<ProfileValue> {
  return isExtraKey(key) ? ExtraValueSchema : PROFILE_VALUE_SCHEMAS[key as CoreProfileKey];
}

function checkValueForKey(entry: { key: ProfileKey; value: unknown }, ctx: z.RefinementCtx) {
  const result = profileValueSchema(entry.key).safeParse(entry.value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: "custom", message: issue.message, path: ["value", ...issue.path] });
    }
  }
}

export const ConfidenceSchema = z.enum(["high", "medium", "low"]).nullable();
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const EvidenceSchema = z.object({ messageId: z.string(), reason: z.string() });
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ProfileSourceSchema = z.enum(["scan", "you"]);
export type ProfileSource = z.infer<typeof ProfileSourceSchema>;

export const ProfileEntrySchema = z
  .object({
    key: ProfileKeySchema,
    label: z.string(),
    value: ProfileValueSchema,
    confidence: ConfidenceSchema,
    evidence: z.array(EvidenceSchema),
    source: ProfileSourceSchema,
    updatedAt: IsoDateTimeSchema,
    /** The user id of whoever set it last, null when the scan did. */
    updatedBy: z.uuid().nullable(),
  })
  .superRefine(checkValueForKey);
export type ProfileEntry = z.infer<typeof ProfileEntrySchema>;

/** The name a confirmed profile gets until the user renames it (F6.5). */
export const DEFAULT_PROFILE_NAME = "My job search";

export const ProfileSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string().min(1).max(100),
  entries: z.array(ProfileEntrySchema),
  confirmedAt: IsoDateTimeSchema.nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileListSchema = z.object({ items: z.array(ProfileSchema) });
export type ProfileList = z.infer<typeof ProfileListSchema>;

/** PATCH /profiles/:profileId: rename, and/or replace some entries' values (source: you). */
export const ProfilePatchSchema = z.object({
  name: TextSchema.trim().min(1).max(100).optional(),
  entries: z
    .array(
      z.object({ key: ProfileKeySchema, value: ProfileValueSchema }).superRefine(checkValueForKey),
    )
    .optional(),
});
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

/**
 * The preferences one of the user's own replies states (task prefs.v1): for each core key the
 * reply mentions, values of that key's shape, plus extra facts as {slug: text}.
 */
export const PreferencesSchema = z.object({
  target_roles: PROFILE_VALUE_SCHEMAS.target_roles.optional(),
  seniority: PROFILE_VALUE_SCHEMAS.seniority.optional(),
  places: PROFILE_VALUE_SCHEMAS.places.optional(),
  remote: PROFILE_VALUE_SCHEMAS.remote.optional(),
  contracts: PROFILE_VALUE_SCHEMAS.contracts.optional(),
  min_pay: PROFILE_VALUE_SCHEMAS.min_pay.optional(),
  languages: PROFILE_VALUE_SCHEMAS.languages.optional(),
  work_permits: PROFILE_VALUE_SCHEMAS.work_permits.optional(),
  reply_to: PROFILE_VALUE_SCHEMAS.reply_to.optional(),
  deal_breakers: PROFILE_VALUE_SCHEMAS.deal_breakers.optional(),
  extra: z.record(TextSchema, TextSchema).optional(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

/** One reply's preferences as the model writes them: `extra` as a list (ExtraAnswerSchema). */
export const PreferencesAnswerSchema = PreferencesSchema.extend({
  extra: ExtraAnswerSchema.optional(),
});

/** What the intake aggregation reads: the user's replies' preferences and the job mail's facts. */
export const IntakeInputSchema = z.object({
  replies: z.array(
    z.object({ messageId: z.string(), date: IsoDateTimeSchema, preferences: PreferencesSchema }),
  ),
  jobs: z.array(
    z.object({
      messageId: z.string(),
      date: IsoDateTimeSchema,
      category: CategorySchema,
      roles: z.array(JobFactsSchema),
    }),
  ),
});
export type IntakeInput = z.infer<typeof IntakeInputSchema>;

export const NOT_ENOUGH_EVIDENCE = "Not enough evidence";

export const IntakeProposalEntrySchema = z
  .object({
    key: ProfileKeySchema,
    label: z.string(),
    value: ProfileValueSchema,
    confidence: ConfidenceSchema,
    evidence: z.array(EvidenceSchema),
    /** Set when nothing could be proposed: the answer is empty and stands out (F6.3). */
    emptyReason: z.literal(NOT_ENOUGH_EVIDENCE).nullable(),
  })
  .superRefine(checkValueForKey);
export type IntakeProposalEntry = z.infer<typeof IntakeProposalEntrySchema>;

export const IntakeProposalSchema = z.object({ entries: z.array(IntakeProposalEntrySchema) });
export type IntakeProposal = z.infer<typeof IntakeProposalSchema>;

/** One of the user's edits to the intake form before Confirm. */
export const IntakeEditSchema = z
  .object({
    key: ProfileKeySchema,
    value: ProfileValueSchema,
    source: ProfileSourceSchema,
    updatedBy: z.uuid().nullable(),
    updatedAt: IsoDateTimeSchema,
  })
  .superRefine(checkValueForKey);
export type IntakeEdit = z.infer<typeof IntakeEditSchema>;

/** An extra question the model proposed (task intake.v1); evidence lists Message-IDs. */
export const ExtraQuestionSchema = z.object({
  slug: ExtraSlugSchema,
  label: TextSchema,
  options: z.array(TextSchema),
  evidence: z.array(TextSchema),
});
export type ExtraQuestion = z.infer<typeof ExtraQuestionSchema>;

/** At most five extra questions (F6.1). */
export const MAX_EXTRA_QUESTIONS = 5;

export const IntakeExtrasStatusSchema = z.enum(["none", "pending", "done", "failed"]);
export type IntakeExtrasStatus = z.infer<typeof IntakeExtrasStatusSchema>;

/** GET /intake: the proposal, the user's edits so far, and the extra questions' state. */
export const IntakeFormSchema = z.object({
  proposal: IntakeProposalSchema,
  edits: z.array(IntakeEditSchema),
  extras: z.object({
    status: IntakeExtrasStatusSchema,
    questions: z.array(ExtraQuestionSchema).max(MAX_EXTRA_QUESTIONS),
  }),
});
export type IntakeForm = z.infer<typeof IntakeFormSchema>;

/** PUT /intake/answers/:key; the value is checked against the key's schema. */
export const IntakeAnswerInputSchema = z.object({ value: ProfileValueSchema });
export type IntakeAnswerInput = z.infer<typeof IntakeAnswerInputSchema>;

/** POST /intake/confirm. */
export const ConfirmIntakeInputSchema = z.object({
  name: TextSchema.trim().min(1).max(100).optional(),
});
export type ConfirmIntakeInput = z.infer<typeof ConfirmIntakeInputSchema>;
