import { Hono } from "hono";
import type { SignedInEnv } from "../access";
import { requireUser } from "../auth/session";
import type { AppDeps } from "../deps";
import { notImplemented } from "./not-implemented";

// Deleting one's account (MVP 3, F7.3): GET /deletion lists what goes
// (AccountDeletionPreviewSchema), DELETE / deletes it (DeleteAccountInputSchema). Built by the
// workspace-admin slice. Mounted at /api/account for the signed-in user.

export function accountRoutes(_deps: AppDeps) {
  return new Hono<SignedInEnv>()
    .use(requireUser)
    .get("/deletion", notImplemented)
    .delete("/", notImplemented);
}
