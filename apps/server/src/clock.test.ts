import { describe, expect, it } from "vitest";
import { DAY, movableClock, systemClock } from "./clock";

describe("clocks", () => {
  it("the system clock tells the real time", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it("a movable clock stands still until moved", () => {
    const clock = movableClock(new Date("2026-10-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-10-01T00:00:00.000Z");
    clock.advance(7 * DAY);
    expect(clock.now().toISOString()).toBe("2026-10-08T00:00:00.000Z");
    clock.set(new Date("2027-01-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
