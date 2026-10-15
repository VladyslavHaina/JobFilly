import type { Context } from "hono";
import type { WorkspaceEnv } from "../access";

// The answer of a pinned route whose handler a slice hasn't written yet. Its role guard runs
// first, so a non-member still gets 404 and a member without the role 403.
export const notImplemented = (c: Context<WorkspaceEnv>) =>
  c.json({ error: "not_implemented", message: "This isn't available yet" }, 501);
