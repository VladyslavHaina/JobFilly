import { findUserByEmail, registerAccount } from "@jobfilly/db";
import {
  RegisterInputSchema,
  type SessionInfo,
  type SessionState,
  SIGN_IN_FAILED_MESSAGE,
  SignInInputSchema,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { type AppEnv, validJson } from "../access";
import { hashPassword, UNKNOWN_USER_HASH, verifyPassword } from "../auth/password";
import { endSession, requireUser, startSession } from "../auth/session";
import type { AppDeps } from "../deps";

/** "Maria Santos's workspace" for Maria Santos: the full name. */
export function personalWorkspaceName(name: string): string {
  return `${name.trim()}'s workspace`;
}

// /api/auth: register, sign in, sign out, me and session (F1.1–F1.5).
export function authRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .post("/register", validJson(RegisterInputSchema), async (c) => {
      const input = c.req.valid("json");
      const result = await registerAccount(deps.db, {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        workspaceName: personalWorkspaceName(input.name),
      });
      if (!result.ok) {
        return c.json(
          {
            error: "email_taken",
            message: "An account with this email already exists. Sign in instead.",
          },
          409,
        );
      }
      await startSession(deps, c, result.user.id);
      const log = c.get("log").child({ userId: result.user.id });
      log.info("auth.registered", { workspaceId: result.workspaceId });
      log.info("auth.signed_in");
      c.set("user", result.user);
      return c.json({ user: result.user } satisfies SessionInfo, 201);
    })
    .post("/sign-in", validJson(SignInInputSchema), async (c) => {
      const input = c.req.valid("json");
      const user = await findUserByEmail(deps.db, input.email);
      // An unknown email costs as much as a wrong password, and both get the same answer.
      const valid = await verifyPassword(input.password, user?.passwordHash ?? UNKNOWN_USER_HASH);
      if (!user || !valid) {
        c.get("log").warn("auth.sign_in_failed");
        return c.json({ error: "invalid_credentials", message: SIGN_IN_FAILED_MESSAGE }, 401);
      }
      // A new session id at every sign-in; any session the browser still had ends.
      await endSession(deps, c, { clearCookie: false });
      await startSession(deps, c, user.id);
      c.get("log").child({ userId: user.id }).info("auth.signed_in");
      const { passwordHash: _, ...publicUser } = user;
      c.set("user", publicUser);
      return c.json({ user: publicUser } satisfies SessionInfo);
    })
    .post("/sign-out", async (c) => {
      const user = c.get("user");
      await endSession(deps, c);
      if (user) c.get("log").info("auth.signed_out");
      return c.body(null, 204);
    })
    .get("/me", requireUser, (c) => c.json({ user: c.get("user") } satisfies SessionInfo))
    .get("/session", (c) => c.json({ user: c.get("user") ?? null } satisfies SessionState));
}
