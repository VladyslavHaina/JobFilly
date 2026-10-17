import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { SEND_TOKEN_TTL_MINUTES } from "@jobfilly/schema";

// The confirmation token (MVP 3, F4.3; D10 of the plan): stateless, an HMAC under a key derived
// from JOBFILLY_SECRET_KEY over the workspace, the draft, the user who saw the confirmation and
// the draft's content hash, good for SEND_TOKEN_TTL_MINUTES. Any replica checks it without a
// lookup. Editing the draft changes its hash, so a token shown before the edit no longer confirms
// it: the user confirms again. The hash is carried in the token (it is a digest of what the user
// is shown anyway) so a stale token can be told apart from a forged one.

const VERSION = "v1";
const TTL_MS = SEND_TOKEN_TTL_MINUTES * 60_000;

export interface TokenSubject {
  workspaceId: string;
  draftId: string;
  userId: string;
}

const keys = new WeakMap<Uint8Array, Buffer>();

/** The token key: HKDF-SHA256 of the app's secret key, for this use only. */
function tokenKey(secretKey: Uint8Array): Buffer {
  let key = keys.get(secretKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secretKey, "", "jobfilly send confirmation v1", 32));
    keys.set(secretKey, key);
  }
  return key;
}

function mac(secretKey: Uint8Array, s: TokenSubject, contentHash: string, expires: number) {
  return createHmac("sha256", tokenKey(secretKey))
    .update([VERSION, s.workspaceId, s.draftId, s.userId, contentHash, String(expires)].join("\n"))
    .digest();
}

/** A token confirming exactly the content with `contentHash`, and when it expires. */
export function signSendToken(
  secretKey: Uint8Array,
  subject: TokenSubject,
  contentHash: string,
  now: Date,
): { token: string; expiresAt: Date } {
  const expires = now.getTime() + TTL_MS;
  const signature = mac(secretKey, subject, contentHash, expires).toString("base64url");
  return {
    token: [VERSION, String(expires), contentHash, signature].join("."),
    expiresAt: new Date(expires),
  };
}

export type TokenCheck =
  | { ok: true; contentHash: string }
  /** Not a token of ours for this workspace, draft and user. */
  | { ok: false; reason: "invalid" }
  /** Ours, but too old: the user confirms again. */
  | { ok: false; reason: "expired" };

/** Checks a token for the subject; the caller compares the hash with the draft's content now. */
export function checkSendToken(
  secretKey: Uint8Array,
  subject: TokenSubject,
  token: string,
  now: Date,
): TokenCheck {
  const [version, expiresText, contentHash, signature, ...rest] = token.split(".");
  if (version !== VERSION || !expiresText || !contentHash || !signature || rest.length > 0) {
    return { ok: false, reason: "invalid" };
  }
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires)) return { ok: false, reason: "invalid" };
  // Compared as text, so a signature written another way (base64's unused low bits) isn't taken.
  const expected = Buffer.from(mac(secretKey, subject, contentHash, expires).toString("base64url"));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }
  if (now.getTime() > expires) return { ok: false, reason: "expired" };
  return { ok: true, contentHash };
}
