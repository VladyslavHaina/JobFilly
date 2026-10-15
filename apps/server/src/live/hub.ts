import type { Notifier, Unlisten } from "@jobfilly/db";
import { type LiveEvent, LiveEventSchema } from "@jobfilly/schema";
import { z } from "zod";
import type { Logger } from "../log";

// Live updates (ARCHITECTURE › Background work and live updates). publish() sends an event
// through Postgres NOTIFY; every replica LISTENs and hands it to the SSE streams of that
// workspace it holds, so a browser connected to any replica sees work done on any other.

export const LIVE_CHANNEL = "jobfilly_live";

const EnvelopeSchema = z.object({ workspaceId: z.uuid(), event: LiveEventSchema });

export type LiveListener = (event: LiveEvent) => void;

export interface LiveHub {
  /** Starts listening for events published by any replica. */
  start(): Promise<void>;
  /** Sends `event` to every open stream of the workspace, on every replica. */
  publish(workspaceId: string, event: LiveEvent): Promise<void>;
  /** Registers one stream of this replica; returns the function that unregisters it. */
  subscribe(workspaceId: string, listener: LiveListener, onClose: () => void): () => void;
  /** Closes every open stream (shutdown): browsers reconnect, to another replica. */
  closeAll(): void;
  /** How many streams this replica holds. */
  readonly streams: number;
  stop(): Promise<void>;
}

interface Stream {
  listener: LiveListener;
  onClose: () => void;
}

export function createLiveHub(notifier: Notifier, log: Logger): LiveHub {
  const byWorkspace = new Map<string, Set<Stream>>();
  let unlisten: Unlisten | null = null;

  const deliver = (payload: string) => {
    let parsed: z.infer<typeof EnvelopeSchema>;
    try {
      parsed = EnvelopeSchema.parse(JSON.parse(payload));
    } catch (error) {
      log.warn("live.error", { error });
      return;
    }
    for (const stream of byWorkspace.get(parsed.workspaceId) ?? []) {
      try {
        stream.listener(parsed.event);
      } catch (error) {
        log.warn("live.error", { error });
      }
    }
  };

  return {
    async start() {
      unlisten ??= await notifier.listen(LIVE_CHANNEL, deliver);
    },
    async publish(workspaceId, event) {
      const payload = JSON.stringify({ workspaceId, event: LiveEventSchema.parse(event) });
      await notifier.notify(LIVE_CHANNEL, payload);
    },
    subscribe(workspaceId, listener, onClose) {
      const stream: Stream = { listener, onClose };
      let set = byWorkspace.get(workspaceId);
      if (!set) {
        set = new Set();
        byWorkspace.set(workspaceId, set);
      }
      set.add(stream);
      return () => {
        const current = byWorkspace.get(workspaceId);
        current?.delete(stream);
        if (current?.size === 0) byWorkspace.delete(workspaceId);
      };
    },
    closeAll() {
      const all = [...byWorkspace.values()].flatMap((set) => [...set]);
      byWorkspace.clear();
      for (const stream of all) stream.onClose();
    },
    get streams() {
      let n = 0;
      for (const set of byWorkspace.values()) n += set.size;
      return n;
    },
    async stop() {
      const u = unlisten;
      unlisten = null;
      await u?.();
    },
  };
}
