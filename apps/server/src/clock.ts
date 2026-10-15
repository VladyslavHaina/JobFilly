// Time comes from an injectable clock, so tests can move it (session and invite expiry, leases).

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock that stands still until moved; used by tests. */
export interface MovableClock extends Clock {
  set(at: Date): void;
  advance(ms: number): void;
}

export function movableClock(start: Date): MovableClock {
  let at = start.getTime();
  return {
    now: () => new Date(at),
    set: (d) => {
      at = d.getTime();
    },
    advance: (ms) => {
      at += ms;
    },
  };
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
