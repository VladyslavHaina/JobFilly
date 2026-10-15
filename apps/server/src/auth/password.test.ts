import { describe, expect, it } from "vitest";
import { hashPassword, PASSWORD_PARAMS, UNKNOWN_USER_HASH, verifyPassword } from "./password";

describe("password hashes", () => {
  it("stores scrypt with its parameters and a random salt, never the password", async () => {
    const a = await hashPassword("E2E-SECRET-maria-login");
    const b = await hashPassword("E2E-SECRET-maria-login");
    expect(a).toMatch(/^scrypt\$32768\$8\$3\$[\w-]{22}\$[\w-]{43}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("E2E-SECRET");
    expect(PASSWORD_PARAMS).toEqual({ N: 32768, r: 8, p: 3 });
  });

  it("verifies the right password only", async () => {
    const hash = await hashPassword("correct horse battery", { N: 1024, r: 8, p: 1 });
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
    expect(await verifyPassword("", UNKNOWN_USER_HASH)).toBe(false);
  });
});
