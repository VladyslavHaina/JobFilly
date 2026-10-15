import { z } from "zod";

/** Passwords have at least 12 characters (F1.1); the upper bound only guards the hash. */
export const PASSWORD_MIN_LENGTH = 12;

const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address" }));

export const RegisterInputSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(200),
  email: EmailSchema,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(1024),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const SignInInputSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(1024),
});
export type SignInInput = z.infer<typeof SignInInputSchema>;

export const UserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
});
export type User = z.infer<typeof UserSchema>;

/** The answer of register, sign-in and me. */
export const SessionInfoSchema = z.object({ user: UserSchema });
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/**
 * GET /api/auth/session: who is signed in, null when nobody is. Always 200, so a signed-out page
 * load shows no failed request; GET /api/auth/me answers 401 instead.
 */
export const SessionStateSchema = z.object({ user: UserSchema.nullable() });
export type SessionState = z.infer<typeof SessionStateSchema>;

/** The one message for wrong credentials (F1.5). */
export const SIGN_IN_FAILED_MESSAGE = "Email or password is incorrect";
