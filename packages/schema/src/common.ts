import { z } from "zod";

// Small building blocks shared by several domain modules.

/** An ISO 8601 timestamp with an offset, as JSON carries dates. */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

/** ISO 3166-1 alpha-2 country code, upper case ("DE"). */
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "an ISO 3166-1 alpha-2 code");

/** ISO 4217 currency code, upper case ("EUR"). */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "an ISO 4217 code");

/** A UTC offset written as "UTC+01:00" or "UTC-05:30". */
export const UtcOffsetSchema = z
  .string()
  .regex(/^UTC[+-](0\d|1[0-4]):[0-5]\d$/, 'a UTC offset like "UTC+01:00"');

/** An inclusive range of UTC offsets, as a job or a profile states it. */
export const TimeZoneRangeSchema = z.object({ from: UtcOffsetSchema, to: UtcOffsetSchema });
export type TimeZoneRange = z.infer<typeof TimeZoneRangeSchema>;

/** The pay period of a salary or a rate. */
export const PayPeriodSchema = z.enum(["hour", "day", "week", "month", "year"]);
export type PayPeriod = z.infer<typeof PayPeriodSchema>;

/**
 * A row id as it comes in a URL path: a UUID in 8-4-4-4-12 hex form. Anything else names no row,
 * so the server answers 404 without asking the database.
 */
export const IdSchema = z.guid();

/** The body of every error answer of the API. `error` is a stable code, `message` plain words. */
export const ApiErrorSchema = z.object({ error: z.string(), message: z.string().optional() });
export type ApiError = z.infer<typeof ApiErrorSchema>;
