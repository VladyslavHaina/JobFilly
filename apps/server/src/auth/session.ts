import { createHash, randomBytes } from "node:crypto";
import { createSession, deleteSession, findSession, touchSession } from "@jobfilly/db";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, SignedInEnv } from "../access/env";
import { DAY, MINUTE } from "../clock";
import type { AppDeps } from "../deps";

// Cookie sessions (F1.2–F1.4). The cookie jf_session holds 32 random bytes; Postgres keeps only
// their SHA-256, so any replica validates any session. A session ends after 7 days without use
// and 30 days after sign-in at most, by the injectable clock.

export const SESSION_COOKIE = "jf_session";
export const SESSION_IDLE_MS = 7 * DAY;
export const SESSION_ABSOLUTE_MS = 30 * DAY;
/** last_used_at is written at most this often, not on every request. */
const TOUCH_EVERY_MS = MINUTE;

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Starts a new session for the user and sets its cookie. */
export async function startSession(deps: AppDeps, c: Context, userId: string): Promise<void> {
  const token = newToken();
  await createSession(deps.db, { userId, tokenHash: hashToken(token), now: deps.clock.now() });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: deps.config.secureCookies,
    maxAge: SESSION_ABSOLUTE_MS / 1000,
  });
}

/** Ends the request's session on the server and, unless a new one replaces it, clears the cookie. */
export async function endSession(
  deps: AppDeps,
  c: Context<AppEnv>,
  options: { clearCookie: boolean } = { clearCookie: true },
): Promise<void> {
  const sessionId = c.get("sessionId");
  if (sessionId) await deleteSession(deps.db, sessionId);
  c.set("sessionId", undefined);
  if (options.clearCookie) {
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: deps.config.secureCookies });
  }
}

/** Resolves the cookie to a live session: sets `user` and `sessionId`, or leaves them unset. */
export function sessionMiddleware(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const session = await findSession(deps.db, hashToken(token));
      const now = deps.clock.now().getTime();
      if (session) {
        const idle = now - session.lastUsedAt.getTime() >= SESSION_IDLE_MS;
        const old = now - session.createdAt.getTime() >= SESSION_ABSOLUTE_MS;
        if (idle || old) {
          await deleteSession(deps.db, session.id);
        } else {
          if (now - session.lastUsedAt.getTime() >= TOUCH_EVERY_MS) {
            await touchSession(deps.db, session.id, new Date(now));
          }
          c.set("user", session.user);
          c.set("sessionId", session.id);
          c.set("log", c.get("log").child({ userId: session.user.id }));
        }
      }
    }
    await next();
  };
}

/** 401 unless the request has a live session. */
export const requireUser: MiddlewareHandler<SignedInEnv> = async (c, next) => {
  if (!c.get("user") || !c.get("sessionId")) {
    return c.json({ error: "unauthenticated", message: "Sign in to continue" }, 401);
  }
  await next();
};
