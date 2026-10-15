import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, seal } from "./secrets";

const key = new Uint8Array(randomBytes(32));

describe("the secret box", () => {
  it("seals and opens a secret, never storing it in the clear", () => {
    const sealed = seal(key, "E2E-SECRET-maria-imap");
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain("E2E-SECRET");
    expect(open(key, sealed)).toBe("E2E-SECRET-maria-imap");
  });

  it("gives a different value each time thanks to a random nonce", () => {
    const a = seal(key, "same");
    const b = seal(key, "same");
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
    expect(Buffer.from(a.split(".")[1] ?? "", "base64url")).toHaveLength(12);
  });

  it("can't be opened with another key or after tampering", () => {
    const sealed = seal(key, "E2E-SECRET-ai-key");
    expect(() => open(new Uint8Array(randomBytes(32)), sealed)).toThrow(/can't be opened/);
    const [v, n, c, t] = sealed.split(".") as [string, string, string, string];
    const flipped = Buffer.from(c, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => open(key, [v, n, flipped.toString("base64url"), t].join("."))).toThrow();
    expect(() => open(key, "plain")).toThrow(/not a sealed secret/);
  });

  it("refuses a truncated authentication tag", () => {
    const sealed = seal(key, "E2E-SECRET-ai-key");
    const [v, n, c, t] = sealed.split(".") as [string, string, string, string];
    expect(Buffer.from(t, "base64url")).toHaveLength(16);
    for (const length of [4, 8, 12, 15]) {
      const cut = Buffer.from(t, "base64url").subarray(0, length).toString("base64url");
      expect(() => open(key, [v, n, c, cut].join("."))).toThrow(/can't be opened/);
    }
  });

  it("needs a 32-byte key", () => {
    expect(() => seal(new Uint8Array(16), "x")).toThrow(/32 bytes/);
  });
});
