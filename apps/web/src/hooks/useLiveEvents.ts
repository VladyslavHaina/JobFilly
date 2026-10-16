import {
  type CurrentScan,
  LIVE_EVENT_TYPES,
  type LiveEvent,
  LiveEventSchema,
  type ScanProgress,
} from "@jobfilly/schema";
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

const STATUS_ORDER: Record<ScanProgress["status"], number> = { queued: 0, running: 1, stopped: 2 };

/**
 * The current scan as a scan event says, or `current` as it is when the event is older than what
 * is shown: another scan's, or behind it (a refetch may have answered first). What is stored is
 * what an event says (the run stores before it sends), so the screen shows it without waiting
 * for the refetch, which follows as for any event and brings what the event has not (when the
 * run stopped, the workspace's tokens).
 */
function withScanEvent(
  current: CurrentScan | undefined,
  event: Extract<LiveEvent, { type: "scan.progress" | "scan.stopped" }>,
): CurrentScan | undefined {
  const shown = current?.progress;
  if (!current || !shown || shown.scanId !== event.data.scanId) return current;
  const { stopMessage, ...progress } =
    event.type === "scan.stopped" ? event.data : { ...event.data, stopMessage: null };
  const behind =
    STATUS_ORDER[progress.status] < STATUS_ORDER[shown.status] ||
    shown.status === "stopped" ||
    progress.analyzed < shown.analyzed ||
    progress.calls < shown.calls;
  if (behind) return current;
  return { ...current, progress, stopMessage, stoppedAt: null };
}

/** A burst of events settles into one refetch: it waits this long after the last event... */
export const LIVE_SETTLE_MS = 150;
/** ...but no longer than this after the first, so a steady stream still shows progress. */
export const LIVE_MAX_WAIT_MS = 1000;

/**
 * Refetches the queries of the areas events touch; mounted once by the app shell. Processing a
 * batch sends tens of events within a fraction of a second, so the areas are collected and
 * invalidated together once the burst settles: one refetch per active query, not one per event.
 */
export function useLiveInvalidation(workspaceId: string): { connected: boolean } {
  const client = useQueryClient();
  const collect = useRef<(event: LiveEvent) => void>(() => {});

  // One batch per workspace: a switch (or unmount) drops what the old one had collected.
  useEffect(() => {
    const pending = new Set<LiveArea | "workspaces">();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let since: number | null = null;
    const flush = () => {
      timer = undefined;
      since = null;
      const areas = [...pending];
      pending.clear();
      for (const area of areas) {
        void client.invalidateQueries({
          queryKey:
            area === "workspaces" ? queryKeys.workspaces : queryKeys.area(workspaceId, area),
        });
      }
    };
    collect.current = (event) => {
      if (event.type === "scan.progress" || event.type === "scan.stopped") {
        // Shown at once, not after the refetch: the screen's GET waits for the database like any
        // request, which takes long while the pipeline keeps it busy (F4.6). A request already
        // under way may hold older counts, so it is dropped; the refetch below asks again.
        const key = queryKeys.currentScan(workspaceId);
        const current = client.getQueryData<CurrentScan>(key);
        const next = withScanEvent(current, event);
        if (next !== current) {
          void client.cancelQueries({ queryKey: key });
          client.setQueryData(key, next);
        }
      }
      for (const area of AREA[event.type]) pending.add(area);
      if (event.type === "workspace.updated") pending.add("workspaces");
      const now = Date.now();
      since ??= now;
      clearTimeout(timer);
      timer = setTimeout(
        flush,
        Math.max(0, Math.min(LIVE_SETTLE_MS, since + LIVE_MAX_WAIT_MS - now)),
      );
    };
    return () => {
      clearTimeout(timer);
      collect.current = () => {};
    };
  }, [client, workspaceId]);

  return useLiveEvents(workspaceId, (event) => collect.current(event));
}
