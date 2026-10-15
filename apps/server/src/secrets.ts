import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Secrets (mail passwords, AI keys) are sealed with AES-256-GCM under JOBFILLY_SECRET_KEY before
// they are stored, with a fresh random 96-bit nonce each time, so sealing the same secret twice
// gives different values. The stored form is "v1.<nonce>.<ciphertext>.<tag>" in base64url.

const VERSION = "v1";
/** The full 128-bit GCM tag; a shorter one would weaken the integrity check, so it is refused. */
const TAG_LENGTH = 16;

function checkKey(key: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error("the secret key must be 32 bytes");
  return key;
}

/** Seals `plaintext` with `key` (config.secretKey). */
export function seal(key: Uint8Array, plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", checkKey(key), nonce, {
    authTagLength: TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, nonce, ciphertext, tag]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Opens a sealed value; throws when it was sealed with another key or has been altered. */
export function open(key: Uint8Array, sealed: string): string {
  const [version, nonce, ciphertext, tag, ...rest] = sealed.split(".");
  if (version !== VERSION || !nonce || ciphertext === undefined || !tag || rest.length > 0) {
    throw new Error("not a sealed secret");
  }
  const authTag = Buffer.from(tag, "base64url");
  if (authTag.length !== TAG_LENGTH) throw new Error("the secret can't be opened with this key");
  const decipher = createDecipheriv("aes-256-gcm", checkKey(key), Buffer.from(nonce, "base64url"), {
    authTagLength: TAG_LENGTH,
  });
  try {
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("the secret can't be opened with this key");
  }
}
