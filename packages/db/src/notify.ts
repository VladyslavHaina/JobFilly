import type { PGlite } from "@electric-sql/pglite";
import pg from "pg";

/** Stops listening; resolves once the channel is no longer delivered to this callback. */
export type Unlisten = () => Promise<void>;

/**
 * Postgres LISTEN/NOTIFY, so every replica hears what any replica publishes (live updates).
 * Payloads are short strings (Postgres limits them to just under 8000 bytes).
 */
export interface Notifier {
  listen(channel: string, onPayload: (payload: string) => void): Promise<Unlisten>;
  notify(channel: string, payload: string): Promise<void>;
  close(): Promise<void>;
}

/** Channel names are plain identifiers, so they can be quoted safely in LISTEN. */
function checkChannel(channel: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(channel)) {
    throw new Error(`invalid channel name "${channel}"`);
  }
  return channel;
}

type Callbacks = Map<string, Set<(payload: string) => void>>;

function addCallback(callbacks: Callbacks, channel: string, cb: (payload: string) => void) {
  let set = callbacks.get(channel);
  if (!set) {
    set = new Set();
    callbacks.set(channel, set);
  }
  set.add(cb);
}

function removeCallback(callbacks: Callbacks, channel: string, cb: (payload: string) => void) {
  const set = callbacks.get(channel);
  set?.delete(cb);
  if (set && set.size === 0) {
    callbacks.delete(channel);
    return true;
  }
  return false;
}

export interface PgNotifierOptions {
  /** Called when the listening connection fails; it reconnects and listens again on its own. */
  onError?: (error: Error) => void;
  /** Delay before reconnecting the listening connection. */
  reconnectDelayMs?: number;
  /** Makes the dedicated listening client; tests pass a fake. */
  createClient?: (config: pg.ClientConfig) => pg.Client;
}

/**
 * LISTEN on one dedicated connection (a pooled one could be handed to someone else), NOTIFY
 * through the pool. The dedicated connection reconnects after an error and listens again.
 */
export function pgNotifier(
  pool: pg.Pool,
  clientConfig: pg.ClientConfig,
  options: PgNotifierOptions = {},
): Notifier {
  const callbacks: Callbacks = new Map();
  let client: pg.Client | null = null;
  /** The channels the current client is listening on. */
  let listening = new Set<string>();
  let connecting: Promise<pg.Client> | null = null;
  let closed = false;

  const dispatch = (msg: pg.Notification) => {
    for (const cb of callbacks.get(msg.channel) ?? []) cb(msg.payload ?? "");
  };

  const connect = (): Promise<pg.Client> => {
    if (client) return Promise.resolve(client);
    if (connecting) return connecting;
    connecting = (async () => {
      const c = options.createClient?.(clientConfig) ?? new pg.Client(clientConfig);
      c.on("notification", dispatch);
      c.on("error", (error) => {
        options.onError?.(error);
        if (client === c) client = null;
        c.removeAllListeners("notification");
        void c.end().catch(() => {});
        if (!closed && callbacks.size > 0) {
          setTimeout(
            () => void connect().catch((e: Error) => options.onError?.(e)),
            options.reconnectDelayMs ?? 1000,
          );
        }
      });
      const channels = new Set<string>();
      try {
        await c.connect();
        for (const channel of callbacks.keys()) {
          await c.query(`LISTEN "${channel}"`);
          channels.add(channel);
        }
      } catch (error) {
        void c.end().catch(() => {});
        throw error;
      }
      client = c;
      listening = channels;
      return c;
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  };

  return {
    async listen(channel, onPayload) {
      checkChannel(channel);
      addCallback(callbacks, channel, onPayload);
      try {
        const c = await connect();
        if (!listening.has(channel)) {
          listening.add(channel);
          await c.query(`LISTEN "${channel}"`);
        }
      } catch (error) {
        removeCallback(callbacks, channel, onPayload);
        throw error;
      }
      return async () => {
        if (removeCallback(callbacks, channel, onPayload) && client) {
          listening.delete(channel);
          await client.query(`UNLISTEN "${channel}"`).catch(() => {});
        }
      };
    },
    async notify(channel, payload) {
      await pool.query("select pg_notify($1, $2)", [checkChannel(channel), payload]);
    },
    async close() {
      closed = true;
      callbacks.clear();
      const c = client;
      client = null;
      if (c) await c.end().catch(() => {});
    },
  };
}

/** LISTEN/NOTIFY on an in-memory PGlite database (tests). */
export function pgliteNotifier(db: PGlite): Notifier {
  const unlistens = new Set<() => Promise<void>>();
  return {
    async listen(channel, onPayload) {
      const stop = await db.listen(checkChannel(channel), onPayload);
      const unlisten = async () => {
        if (!unlistens.delete(unlisten)) return;
        await stop();
      };
      unlistens.add(unlisten);
      return unlisten;
    },
    async notify(channel, payload) {
      await db.query("select pg_notify($1, $2)", [checkChannel(channel), payload]);
    },
    async close() {
      await Promise.all([...unlistens].map((u) => u()));
    },
  };
}
