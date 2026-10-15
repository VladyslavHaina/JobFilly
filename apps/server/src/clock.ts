// Time comes from an injectable clock, so tests can move it (session and invite expiry, leases).

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;
