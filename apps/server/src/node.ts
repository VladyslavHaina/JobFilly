import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app";

export interface ServerOptions {
  hostname: string;
  /** 0 picks a free port. */
  port: number;
  version: string;
  /** Built web UI to serve. Omitted in development, where Vite serves the UI. */
  webDist?: string;
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

// Starts the API (and, when webDist is set, the UI) on a Node HTTP server.
// Used by the server's own entry point and by the desktop app.
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const root = new Hono();
  root.route("/", createApp({ version: options.version }));
  root.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  if (options.webDist) {
    root.use("/*", serveStatic({ root: options.webDist }));
    // Single-page app: any other path gets index.html and the UI routes it.
    root.get("*", serveStatic({ root: options.webDist, path: "index.html" }));
  }

  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: root.fetch, hostname: options.hostname, port: options.port },
      (info: AddressInfo) => {
        const host = info.address.includes(":") ? `[${info.address}]` : info.address;
        resolve({
          url: `http://${host}:${info.port}`,
          close: () =>
            new Promise((done, fail) => server.close((err) => (err ? fail(err) : done()))),
        });
      },
    );
    server.once("error", reject);
  });
}
