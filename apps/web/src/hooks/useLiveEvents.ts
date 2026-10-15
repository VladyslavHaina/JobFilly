import { LIVE_EVENT_TYPES, type LiveEvent, LiveEventSchema } from "@jobfilly/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type LiveArea, queryKeys } from "./queryKeys";

const MAX_BACKOFF_MS = 10_000;

/**
 * Live updates of a workspace over SSE. The browser reconnects on its own after a dropped stream
 * (a replica shutting down); when the stream is refused (closed), this reconnects with a backoff.
 */
export function useLiveEvents(
  workspaceId: string,
  onEvent: (event: LiveEvent) => void,
): { connected: boolean } {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;
    let stopped = false;

    const open = () => {
      const es = new EventSource(`/api/workspaces/${encodeURIComponent(workspaceId)}/events`);
      source = es;
      es.onopen = () => {
        backoff = 1000;
        setConnected(true);
      };
      es.onerror = () => {
        setConnected(false);
        if (es.readyState === EventSource.CLOSED && !stopped) {
          es.close();
          timer = setTimeout(open, backoff);
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        }
      };
      for (const type of LIVE_EVENT_TYPES) {
        es.addEventListener(type, (message) => {
          let data: unknown;
          try {
            data = JSON.parse((message as MessageEvent<string>).data);
          } catch {
            return;
          }
          const parsed = LiveEventSchema.safeParse({ type, data });
          if (parsed.success) handler.current(parsed.data);
        });
      }
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
      setConnected(false);
    };
  }, [workspaceId]);

  return { connected };
}

const AREA: Record<LiveEvent["type"], LiveArea[]> = {
  "scan.progress": ["scan"],
  "scan.stopped": ["scan", "messages", "intake"],
  "messages.updated": ["messages"],
  "intake.updated": ["intake", "profiles"],
  "workspace.updated": ["workspace"],
  "cvs.updated": ["cvs"],
  // A draft's status shows in the inbox rows too.
  "drafts.updated": ["drafts", "messages"],
  "decisions.updated": ["decisions"],
  "profiles.updated": ["profiles"],
  "assistant.updated": ["assistant"],
  "mailbox.updated": ["mailbox"],
};

/** Refetches the queries of the area an event touches; mounted once by the app shell. */
export function useLiveInvalidation(workspaceId: string): { connected: boolean } {
  const client = useQueryClient();
  return useLiveEvents(workspaceId, (event) => {
    for (const area of AREA[event.type]) {
      void client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, area) });
    }
    if (event.type === "workspace.updated") {
      void client.invalidateQueries({ queryKey: queryKeys.workspaces });
    }
  });
}
