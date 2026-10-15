import { z } from "zod";
import {
  CountryCodeSchema,
  CurrencyCodeSchema,
  PayPeriodSchema,
  TimeZoneRangeSchema,
} from "./common";

export const WorkModeSchema = z.enum(["remote", "hybrid", "onsite"]);
export type WorkMode = z.infer<typeof WorkModeSchema>;

export const PlaceSchema = z.object({
  /** ISO 3166-1 alpha-2, or null when only a city is named. */
  country: CountryCodeSchema.nullable(),
  city: z.string().nullable(),
});
export type Place = z.infer<typeof PlaceSchema>;

export const PaySchema = z.object({
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  currency: CurrencyCodeSchema.nullable(),
  period: PayPeriodSchema.nullable(),
  /** The pay exactly as the mail words it. */
  asWritten: z.string(),
});
export type Pay = z.infer<typeof PaySchema>;

/**
 * The universal facts of one role found in a message (F5). Everything the mail doesn't state is
 * null (or an empty list), never guessed. Wording such as contract, seniority and work permit is
 * kept as written, so no market vocabulary is built in.
 */
export const JobFactsSchema = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  agency: z.object({ name: z.string().nullable(), client: z.string().nullable() }).nullable(),
  places: z.array(PlaceSchema),
  workMode: WorkModeSchema.nullable(),
  remoteScope: z.string().nullable(),
  timeZones: TimeZoneRangeSchema.nullable(),
  pay: PaySchema.nullable(),
  contract: z.string().nullable(),
  seniority: z.string().nullable(),
  workPermit: z.string().nullable(),
  skills: z.array(z.string()),
  languages: z.array(z.string()),
  applyUrl: z.string().nullable(),
  extra: z.record(z.string(), z.string()),
});
export type JobFacts = z.infer<typeof JobFactsSchema>;

/**
 * Extra facts as a model writes them (extract.v1, prefs.v1): a list of {key, value}, read back
 * into the { key: value } record. An open record can't be asked of every provider: Anthropic's
 * structured output closes every object, which would hold `extra` to {} without any error. A
 * list of closed objects means the same thing to every provider. A key given twice makes the
 * answer invalid, so no value silently wins.
 */
export const ExtraAnswerSchema = z
  .array(z.object({ key: z.string(), value: z.string() }))
  .refine((entries) => new Set(entries.map((e) => e.key)).size === entries.length, {
    message: "Each extra key at most once",
  })
  .transform((entries) => Object.fromEntries(entries.map((e) => [e.key, e.value])));

/** One role's facts as the model writes them: `extra` as a list; parsed, they are JobFacts. */
export const JobFactsAnswerSchema = JobFactsSchema.extend({ extra: ExtraAnswerSchema });
