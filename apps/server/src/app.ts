import type { Health } from "@jobfilly/schema";
import { Hono } from "hono";

export interface AppOptions {
  version: string;
}

// The HTTP API. Platform-neutral on purpose: the desktop app, the Docker
// container and the tests all mount this same app.
export function createApp(options: AppOptions) {
  return new Hono().get("/api/health", (c) =>
    c.json({ status: "ok", version: options.version } satisfies Health),
  );
}

// The web UI derives its typed client from this.
export type AppType = ReturnType<typeof createApp>;
