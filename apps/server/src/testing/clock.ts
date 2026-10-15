import type { Clock } from "../clock";

/** A clock that stands still until moved (tests only). */
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
