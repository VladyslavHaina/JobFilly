import { describe, expect, it } from "vitest";
import { systemClock } from "./clock";

describe("clocks", () => {
  it("the system clock tells the real time", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
