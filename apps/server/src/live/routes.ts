import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { WorkspaceEnv } from "../access/env";
import { requireRole } from "../access/membership";
import type { AppDeps } from "../deps";

/** A comment line every so often keeps proxies from closing an idle stream. */
const HEARTBEAT_MS = 15_000;

// GET /api/workspaces/:workspaceId/events: Server-Sent Events for every member. Each event's
// name is its type (scan.progress, …) and its data the JSON body. On shutdown the stream closes;
// the browser reconnects (after `retry` ms), through the proxy, to another replica.
export function eventsRoutes(deps: AppDeps, options: { heartbeatMs?: number } = {}) {
  return new Hono<WorkspaceEnv>().get("/", requireRole("viewer"), (c) => {
    const workspaceId = c.get("workspaceId");
    return streamSSE(c, async (stream) => {
      let close!: () => void;
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      const unsubscribe = deps.live.subscribe(
        workspaceId,
        (event) => {
          void stream
            .writeSSE({ event: event.type, data: JSON.stringify(event.data) })
            .catch(close);
        },
        close,
      );
      stream.onAbort(close);
      const heartbeat = setInterval(() => {
        void stream.write(": keep-alive\n\n").catch(close);
      }, options.heartbeatMs ?? HEARTBEAT_MS);
      try {
        await stream.write("retry: 2000\n: connected\n\n");
        await closed;
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });
}
