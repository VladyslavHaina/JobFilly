import { describe, expect, it } from "vitest";
import { checkSendToken, signSendToken } from "./token";

// The confirmation token (F4.3, D10): bound to the workspace, the draft, the user and the draft's
// content hash, good for 15 minutes, checked without any lookup.

const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(8);
const SUBJECT = { workspaceId: "w1", draftId: "d1", userId: "u1" };
const NOW = new Date("2026-10-16T10:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("the send token", () => {
  it("confirms the content it was made for, for 15 minutes", () => {
    const { token, expiresAt } = signSendToken(KEY, SUBJECT, "hash-1", NOW);
    expect(expiresAt).toEqual(at(15 * 60_000));
    expect(checkSendToken(KEY, SUBJECT, token, at(15 * 60_000))).toEqual({
      ok: true,
      contentHash: "hash-1",
    });
    expect(checkSendToken(KEY, SUBJECT, token, at(15 * 60_000 + 1))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("is invalid for another workspace, draft, user or key, or when altered", () => {
    const { token } = signSendToken(KEY, SUBJECT, "hash-1", NOW);
    for (const subject of [
      { ...SUBJECT, workspaceId: "w2" },
      { ...SUBJECT, draftId: "d2" },
      { ...SUBJECT, userId: "u2" },
    ]) {
      expect(checkSendToken(KEY, subject, token, NOW)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(checkSendToken(OTHER_KEY, SUBJECT, token, NOW).ok).toBe(false);
    const [v, expires, , signature] = token.split(".");
    // Another content hash, or a later expiry, with the same signature.
    expect(checkSendToken(KEY, SUBJECT, `${v}.${expires}.hash-2.${signature}`, NOW).ok).toBe(false);
    expect(
      checkSendToken(KEY, SUBJECT, `${v}.${Number(expires) + 1}.hash-1.${signature}`, NOW).ok,
    ).toBe(false);
    // The last character's unused bits flipped: the same bytes, written another way.
    const last = signature?.at(-1) === "A" ? "B" : "A";
    const respelled = `${token.slice(0, -1)}${last}`;
    expect(checkSendToken(KEY, SUBJECT, respelled, NOW).ok).toBe(false);
    for (const junk of ["", "v1", "v1.x.hash-1.sig", "v2.1.hash-1.sig", `${token}.extra`]) {
      expect(checkSendToken(KEY, SUBJECT, junk, NOW)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});
