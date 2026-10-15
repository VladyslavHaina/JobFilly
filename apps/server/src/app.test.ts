import { HealthSchema } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("GET /api/health", () => {
  it("reports the server as up", async () => {
    const res = await createApp({ version: "test" }).request("/api/health");
    expect(res.status).toBe(200);
    expect(HealthSchema.parse(await res.json())).toEqual({ status: "ok", version: "test" });
  });
});
