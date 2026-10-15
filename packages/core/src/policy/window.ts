import { POLICY_DEFAULTS, type PolicyKey, type ProfileEntry } from "@jobfilly/schema";

// The reply policy's numbers (F6.1, F1.6), read from the profile's policy keys with their
// defaults: reply_threshold 70, reply_window_days 14.

const DAY_MS = 24 * 60 * 60 * 1000;

/** A policy key's number: the profile's entry, or its default while unset. */
export function policyValue(
  profile: { entries: readonly ProfileEntry[] } | null,
  key: PolicyKey,
): number {
  const value = profile?.entries.find((e) => e.key === key)?.value;
  const n = Array.isArray(value) ? value[0] : undefined;
  return typeof n === "number" ? n : POLICY_DEFAULTS[key];
}

/**
 * Whether a message received at `date` is still inside the reply window at `now` (F1.6): at most
 * reply_window_days old (default 14). Only such mail gets automatic drafts.
 */
export function withinReplyWindow(
  date: Date | string,
  now: Date,
  profile: { entries: readonly ProfileEntry[] } | null,
): boolean {
  const received = typeof date === "string" ? Date.parse(date) : date.getTime();
  return now.getTime() - received <= policyValue(profile, "reply_window_days") * DAY_MS;
}
