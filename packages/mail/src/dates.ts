// The dates a mail server and a sender hand over (INTERNALDATE, the Date header) are text the app
// doesn't control: "32-Foo-2026" reads as an Invalid Date, and a Date header with the year 20260
// as a real date whose toISOString ("+020260-01-01T00:00:00.000Z") no ISO 8601 timestamp schema
// accepts. Either one, kept, failed every sync for good.

const MAX_YEAR = 9999;

/**
 * The date when it is a real one with a year from 0000 to 9999, so its toISOString is a plain ISO
 * 8601 timestamp; null otherwise, as when there is none, so the caller's fallback applies.
 */
export function usableDate(date: Date | null | undefined): Date | null {
  if (!date) return null;
  const year = date.getUTCFullYear();
  return Number.isNaN(year) || year < 0 || year > MAX_YEAR ? null : date;
}
