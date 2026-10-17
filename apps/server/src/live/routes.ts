import { getMembership } from "@jobfilly/db";
import { type LiveEvent, scopeOf } from "@jobfilly/schema";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { WorkspaceEnv } from "../access/env";
import { requireRole } from "../access/membership";
import { liveSession, sessionTokenHash } from "../auth/session";
import type { AppDeps } from "../deps";
import type { StreamOwner } from "./hub";

/**
 * The event as a member who sees the job pipeline only gets it (MVP 3, F6.2): nothing about
 * drafts or sending, and no Message-IDs (they may be non-job mail's). Null: not sent at all.
 */
function eventForPipeline(event: LiveEvent): LiveEvent | null {
  if (event.type === "drafts.updated" || event.type === "sends.updated") return null;
  if (event.type === "messages.updated") return { type: "messages.updated", data: {} };
  return event;
}

/** A comment line every so often keeps proxies from closing an idle stream. */
const HEARTBEAT_MS = 15_000;

// GET /api/workspaces/:workspaceId/events: Server-Sent Events for every member. Each event's
// name is its type (scan.progress, …) and its data the JSON body. On shutdown the stream closes;
// the browser reconnects (after `retry` ms), through the proxy, to another replica.
//
// The stream belongs to the member's session (F1.4, F1.9). Removing the member or ending the
// session closes it at once on every replica (LiveHub.revoke); and once when it opens and on
// every heartbeat it re-checks that the session is still live and the membership still exists,
// and closes if not, so nothing that ends without a notification keeps a stream open.
export function eventsRoutes(deps: AppDeps, options: { heartbeatMs?: number } = {}) {
  return new Hono<WorkspaceEnv>().get("/", requireRole("viewer"), (c) => {
    const owner: StreamOwner = {
      workspaceId: c.get("workspaceId"),
      userId: c.get("user").id,
      sessionId: c.get("sessionId"),
    };
    // A change of scope closes the stream (LiveHub.revoke), so the scope it opened with holds.
    const pipelineOnly = scopeOf(c.get("membership")) !== "everything";
    const tokenHash = sessionTokenHash(c);
    const log = c.get("log");

    const stillAllowed = async (): Promise<boolean> => {
      if (!tokenHash) return false;
      const session = await liveSession(deps, tokenHash);
      if (session?.id !== owner.sessionId || session.user.id !== owner.userId) return false;
      return (await getMembership(deps.db, owner.workspaceId, owner.userId)) !== null;
    };

    return streamSSE(c, async (stream) => {
      let done = false;
      let finish!: () => void;
      const closed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      // Once closed, nothing more is written, not even in the moment before the stream ends.
      const close = () => {
        done = true;
        finish();
      };
      const unsubscribe = deps.live.subscribe(
        owner,
        (received) => {
          const event = pipelineOnly ? eventForPipeline(received) : received;
          if (done || !event) return;
          void stream
            .writeSSE({ event: event.type, data: JSON.stringify(event.data) })
            .catch(close);
        },
        close,
      );
      stream.onAbort(close);

      let checking = false;
      const check = async () => {
        if (checking) return;
        checking = true;
        try {
          if (!(await stillAllowed())) close();
        } catch (error) {
          // Fail closed: the browser reconnects and is checked afresh.
          log.warn("live.error", { error });
          close();
        } finally {
          checking = false;
        }
      };
      const heartbeat = setInterval(() => {
        void check().then(() => {
          if (!done) void stream.write(": keep-alive\n\n").catch(close);
        });
      }, options.heartbeatMs ?? HEARTBEAT_MS);
      try {
        await stream.write("retry: 2000\n: connected\n\n");
        // Covers a removal or sign-out between the access check and the subscription.
        await check();
        await closed;
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });
}
