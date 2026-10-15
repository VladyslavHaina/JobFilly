import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Passwords are stored as scrypt hashes (F1.5): "scrypt$<N>$<r>$<p>$<salt>$<hash>" in base64url.
// The parameters are stored with each hash, so they can be raised later and old hashes still
// verify. N=2^15, r=8, p=3 is one of OWASP's equivalent scrypt settings, at 32 MiB per hash.

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export const PASSWORD_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 3 };

const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { ...params, maxmem: 256 * params.N * params.r + 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(
  password: string,
  params: ScryptParams = PASSWORD_PARAMS,
): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, params);
  return [
    "scrypt",
    params.N,
    params.r,
    params.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash no password matches, verified when the email is unknown so both cases take as long. */
export const UNKNOWN_USER_HASH = `scrypt$${PASSWORD_PARAMS.N}$${PASSWORD_PARAMS.r}$${PASSWORD_PARAMS.p}$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(KEY_LENGTH).toString("base64url")}`;
