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
export function checkChannel(channel: string): string {
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
  /** Called when the dedicated connection fails; it reconnects and listens again on its own. */
  onError?: (error: Error) => void;
  /** Delay before reconnecting the dedicated connection while something listens. */
  reconnectDelayMs?: number;
  /** Makes the dedicated client; tests pass a fake. */
  createClient?: (config: pg.ClientConfig) => pg.Client;
}

/**
 * LISTEN and NOTIFY on one dedicated connection, never a pooled one. A pooled connection could be
 * handed to someone else while it listens; and a NOTIFY through the pool waits in line behind
 * every query queued for a connection, so while the pipeline keeps the pool busy, live updates
 * (a scan's progress, its stop) would reach the browsers late (F4.6). The dedicated connection
 * reconnects after an error and listens again; a NOTIFY meanwhile opens it again at once.
 */
export function pgNotifier(
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
      if (closed) {
        void c.end().catch(() => {});
        throw new Error("the notifier is closed");
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
      checkChannel(channel);
      if (closed) throw new Error("the notifier is closed");
      const c = await connect();
      await c.query("select pg_notify($1, $2)", [channel, payload]);
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
