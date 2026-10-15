import type { Notifier, Unlisten } from "@jobfilly/db";
import {
  type LiveAccessChange,
  LiveAccessChangeSchema,
  type LiveEnvelope,
  type LiveEvent,
  LiveEventSchema,
  type LiveNotification,
  LiveNotificationSchema,
} from "@jobfilly/schema";
import type { Logger } from "../log";

// Live updates (ARCHITECTURE › Background work and live updates). publish() sends an event
// through Postgres NOTIFY; every replica LISTENs and hands it to the SSE streams of that
// workspace it holds, so a browser connected to any replica sees work done on any other.
//
// A stream belongs to one member's session in one workspace (F1.4, F1.9). When a member is
// removed or a session ends, the replica that made the change sends an access change on the same
// channel, so it reaches every replica in order with the events, and each closes the matching
// streams before it delivers anything published after. The SSE route also re-checks the session
// and the membership on every heartbeat, for whatever ends without a notification.

const LIVE_CHANNEL = "jobfilly_live";

type LiveListener = (event: LiveEvent) => void;

/** Whose stream it is: what was checked when it opened, and what can revoke it. */
export interface StreamOwner {
  workspaceId: string;
  userId: string;
  sessionId: string;
}

export interface LiveHub {
  /** Starts listening for events published by any replica. */
  start(): Promise<void>;
  /** Sends `event` to every open stream of the workspace, on every replica. */
  publish(workspaceId: string, event: LiveEvent): Promise<void>;
  /**
   * Closes the streams that `change` revokes, here at once and on every other replica as the
   * notification arrives. Call it after the change is saved. Never fails on the notification.
   */
  revoke(change: LiveAccessChange): Promise<void>;
  /**
   * Registers one member's stream on this replica; returns the function that unregisters it.
   * revoke() closes it when its owner's membership or session ends.
   */
  subscribe(owner: StreamOwner, listener: LiveListener, onClose: () => void): () => void;
  /** Closes every open stream (shutdown): browsers reconnect, to another replica. */
  closeAll(): void;
  /** How many streams this replica holds. */
  readonly streams: number;
  stop(): Promise<void>;
}

interface Stream {
  owner: StreamOwner;
  listener: LiveListener;
  onClose: () => void;
}

export function createLiveHub(notifier: Notifier, log: Logger): LiveHub {
  const byWorkspace = new Map<string, Set<Stream>>();
  let unlisten: Unlisten | null = null;

  const remove = (stream: Stream) => {
    const set = byWorkspace.get(stream.owner.workspaceId);
    set?.delete(stream);
    if (set?.size === 0) byWorkspace.delete(stream.owner.workspaceId);
  };

  const close = (streams: Stream[]) => {
    for (const stream of streams) remove(stream);
    for (const stream of streams) stream.onClose();
  };

  const revoked = (change: LiveAccessChange): Stream[] => {
    if (change.type === "member.removed") {
      return [...(byWorkspace.get(change.workspaceId) ?? [])].filter(
        (s) => s.owner.userId === change.userId,
      );
    }
    return [...byWorkspace.values()]
      .flatMap((set) => [...set])
      .filter((s) => s.owner.sessionId === change.sessionId);
  };

  const deliver = (payload: string) => {
    let parsed: LiveNotification;
    try {
      parsed = LiveNotificationSchema.parse(JSON.parse(payload));
    } catch (error) {
      log.warn("live.error", { error });
      return;
    }
    if ("type" in parsed) {
      close(revoked(parsed));
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
      const payload = JSON.stringify({
        workspaceId,
        event: LiveEventSchema.parse(event),
      } satisfies LiveEnvelope);
      await notifier.notify(LIVE_CHANNEL, payload);
    },
    async revoke(change) {
      const parsed = LiveAccessChangeSchema.parse(change);
      // Close here at once, whether or not this replica is listening yet; the others on receipt.
      close(revoked(parsed));
      try {
        await notifier.notify(LIVE_CHANNEL, JSON.stringify(parsed));
      } catch (error) {
        // The change itself is already saved; the other replicas' heartbeat checks close them.
        log.warn("live.error", { error });
      }
    },
    subscribe(owner, listener, onClose) {
      const stream: Stream = {
        owner: { ...owner },
        listener,
        onClose,
      };
      const { workspaceId } = stream.owner;
      let set = byWorkspace.get(workspaceId);
      if (!set) {
        set = new Set();
        byWorkspace.set(workspaceId, set);
      }
      set.add(stream);
      return () => remove(stream);
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
