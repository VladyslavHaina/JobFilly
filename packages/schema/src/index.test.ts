import { describe, expect, it } from "vitest";
import { HealthSchema } from "./index";

describe("HealthSchema", () => {
  it("accepts a healthy server and rejects anything else", () => {
    expect(HealthSchema.parse({ status: "ok", version: "1.0.0" })).toEqual({
      status: "ok",
      version: "1.0.0",
    });
    expect(HealthSchema.safeParse({ status: "down", version: "1.0.0" }).success).toBe(false);
  });
});
