import { z } from "zod";
import { CategorySchema } from "./category";
import {
  CountryCodeSchema,
  CurrencyCodeSchema,
  IdSchema,
  IsoDateTimeSchema,
  PayPeriodSchema,
  TextSchema,
  TimeZoneRangeSchema,
} from "./common";
import { ExtraAnswerSchema, JobFactsSchema } from "./facts";

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

/**
 * The policy keys of the reply automation (F6.1, TBD-162): valid profile keys outside the intake
 * form, each a one-number list. A key the profile doesn't set takes its POLICY_DEFAULTS value.
 */
export const POLICY_KEYS = ["reply_threshold", "reply_window_days"] as const;
export const PolicyKeySchema = z.enum(POLICY_KEYS);
export type PolicyKey = z.infer<typeof PolicyKeySchema>;

/** The value a policy key has while the profile doesn't set it. */
export const POLICY_DEFAULTS: Record<PolicyKey, number> = {
  reply_threshold: 70,
  reply_window_days: 14,
};

export const POLICY_LABELS: Record<PolicyKey, string> = {
  reply_threshold: "Fit score that gets an automatic reply",
  reply_window_days: "Days a message can wait for an automatic reply",
};

/** A short lowercase slug naming an extra question. */
export const ExtraSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "a lowercase slug");

/** A core key, a policy key, or "extra.<slug>" for one of the up to five extra questions. */
export const ProfileKeySchema = z.union([
  CoreProfileKeySchema,
  PolicyKeySchema,
  z.string().regex(/^extra\.[a-z0-9][a-z0-9_-]{0,63}$/, "extra.<slug>"),
]);
export type ProfileKey = z.infer<typeof ProfileKeySchema>;

/**
 * Where a profile keeps its own skills: the words of the extra question with the slug "skills",
 * when the profile has one (the core questions name no skills; the CVs do).
 * The match (F4.4) counts a role's skill as matched when the chosen CV or this entry lists it,
 * and match.v1 sees it as the profile's skills. A profile without the entry adds no skills.
 */
export const PROFILE_SKILLS_KEY = "extra.skills" satisfies ProfileKey;

export function isExtraKey(key: string): key is `extra.${string}` {
  return key.startsWith("extra.");
}

export function isPolicyKey(key: string): key is PolicyKey {
  return (POLICY_KEYS as readonly string[]).includes(key);
}

/**
 * How a profile entry is named where its own label isn't at hand: the intake form's label, the
 * policy key's, or an extra question's slug in words ("extra.notice-period" reads "notice period").
 */
export function entryLabel(key: ProfileKey): string {
  if (isPolicyKey(key)) return POLICY_LABELS[key];
  if (isExtraKey(key)) return key.slice("extra.".length).replace(/[-_]+/g, " ");
  return CORE_PROFILE_LABELS[key as CoreProfileKey];
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

/** A policy key's value: one whole number, as a one-item list like every profile value. */
const PolicyNumberSchema = z.number().int().min(0).max(1000);
export const PolicyValueSchema = z.array(PolicyNumberSchema).length(1);

/**
 * The keys whose value is a list of independent items (TBD-195): every core key, read from
 * PROFILE_VALUE_SCHEMAS. A Change `add` appends items to them; on any other key (a policy key,
 * an extra question) `add` sets the whole value. packages/core/src/profile/changes.ts.
 */
export const LIST_PROFILE_KEYS = Object.entries(PROFILE_VALUE_SCHEMAS)
  .filter(([, schema]) => schema instanceof z.ZodArray)
  .map(([key]) => key as CoreProfileKey);

export function isListProfileKey(key: string): key is CoreProfileKey {
  return (LIST_PROFILE_KEYS as readonly string[]).includes(key);
}

/** One item of each list key's value: what a decision answer adds (DecisionAnswer). */
export const PROFILE_ITEM_SCHEMAS = {
  target_roles: TextSchema,
  seniority: TextSchema,
  places: ProfilePlaceSchema,
  remote: RemotePreferenceSchema,
  contracts: TextSchema,
  min_pay: MinPaySchema,
  languages: TextSchema,
  work_permits: WorkPermitSchema,
  reply_to: CategorySchema,
  deal_breakers: TextSchema,
} as const satisfies Record<CoreProfileKey, z.ZodType>;

/** Every shape one item of a profile value can take; words for extra and policy keys too. */
export const ProfileItemSchema = z.union([
  TextSchema,
  z.number(),
  ProfilePlaceSchema,
  RemotePreferenceSchema,
  MinPaySchema,
  WorkPermitSchema,
]);
export type ProfileItem = z.infer<typeof ProfileItemSchema>;

/** The schema of one item of `key`'s value. */
export function profileItemSchema(key: ProfileKey): z.ZodType<ProfileItem> {
  if (isPolicyKey(key)) return PolicyNumberSchema;
  if (isExtraKey(key)) return TextSchema;
  return PROFILE_ITEM_SCHEMAS[key as CoreProfileKey];
}

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
  z.array(z.number()),
]);
export type ProfileValue = z.infer<typeof ProfileValueSchema>;

/** The value schema for a key: its core schema, the policy schema or the extra-answer schema. */
export function profileValueSchema(key: ProfileKey): z.ZodType<ProfileValue> {
  if (isPolicyKey(key)) return PolicyValueSchema;
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

/**
 * Who set an entry: the scan's proposal, the user by hand, a decision answer (F7.4) or an applied
 * assistant proposal (F8.3).
 */
export const ProfileSourceSchema = z.enum(["scan", "you", "decision", "assistant"]);
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
  /**
   * MVP 3 (F1.2): whether roles are assigned to it. Several profiles can be on; at least one stays
   * on. A profile that is off keeps its entries and rules. Absent reads as on (a replica of the
   * previous release doesn't send it during a rolling update).
   */
  enabled: z.boolean().optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileListSchema = z.object({ items: z.array(ProfileSchema) });
export type ProfileList = z.infer<typeof ProfileListSchema>;

/** The path of PATCH /profiles/:profileId. */
export const ProfileParamsSchema = z.object({ profileId: IdSchema });

/**
 * PATCH /profiles/:profileId: rename, switch on or off (MVP 3, F1.2), and/or replace some entries'
 * values (source: you).
 */
export const ProfilePatchSchema = z.object({
  name: TextSchema.trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  entries: z
    .array(
      z.object({ key: ProfileKeySchema, value: ProfileValueSchema }).superRefine(checkValueForKey),
    )
    .optional(),
});
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

/**
 * PATCH /profiles/:profileId's answer: the profile, with how many of its current roles the change
 * changed (F2.3; 0 for a rename). Switching a profile on or off moves roles between profiles, which
 * the re-evaluation shows; it counts no roles here.
 */
export const ProfileChangeResultSchema = ProfileSchema.extend({
  changed: z.number().int().nonnegative(),
});
export type ProfileChangeResult = z.infer<typeof ProfileChangeResultSchema>;

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
  /**
   * MVP 3 (F1.1): set when the form is a re-run of setup's, whose Confirm makes a new profile next
   * to the others: the hint as typed (null without one), and whether it was confirmed already.
   * Absent for the first scan's form.
   */
  rerun: z.object({ hint: z.string().nullable(), confirmed: z.boolean() }).nullable().optional(),
});
export type IntakeForm = z.infer<typeof IntakeFormSchema>;

/** PUT /intake/answers/:key; the value is checked against the key's schema. */
export const IntakeAnswerInputSchema = z.object({ value: ProfileValueSchema });
export type IntakeAnswerInput = z.infer<typeof IntakeAnswerInputSchema>;

/** The path of PUT /intake/answers/:key: a profile key (core, policy or extra.<slug>). */
export const IntakeAnswerParamsSchema = z.object({ key: ProfileKeySchema });

/** POST /intake/confirm. */
export const ConfirmIntakeInputSchema = z.object({
  name: TextSchema.trim().min(1).max(100).optional(),
});
export type ConfirmIntakeInput = z.infer<typeof ConfirmIntakeInputSchema>;

// --- MVP 3: several profiles, and which one each role belongs to (F1.3) -----------------------

/**
 * Who assigned a role to its profile: the app, by the role's places, roles, language and rules
 * (packages/core assignProfile), or an editor by hand, which wins until changed again.
 */
export const RoleProfileSourceSchema = z.enum(["auto", "you"]);
export type RoleProfileSource = z.infer<typeof RoleProfileSourceSchema>;

/**
 * The profile a role belongs to, with why in plain words ("Munich role, German, permanent →
 * 'Germany permanent'"). Matching, CV choice and drafting use this profile.
 */
export const RoleProfileSchema = z.object({
  profileId: z.uuid(),
  name: z.string(),
  reason: z.string(),
  source: RoleProfileSourceSchema,
});
export type RoleProfile = z.infer<typeof RoleProfileSchema>;

/** PUT /messages/:messageId/roles/:position/profile: an editor reassigns the role. */
export const RoleProfileInputSchema = z.object({ profileId: z.uuid() });
export type RoleProfileInput = z.infer<typeof RoleProfileInputSchema>;
