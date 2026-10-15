import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { App } from "./app";
import type { Logger } from "./log";

export interface ServerOptions {
  app: App;
  hostname: string;
  /** 0 picks a free port. */
  port: number;
  /** Built web UI to serve. Omitted in development, where Vite serves the UI. */
  webDist?: string;
  /** Logs http.request for the UI's files; the API logs its own requests. */
  log: Logger;
}

const isApi = (path: string) => path === "/api" || path.startsWith("/api/");

export interface RunningServer {
  url: string;
  /** Stops accepting connections; resolves once every open connection has ended. */
  close(): Promise<void>;
  /** Ends every connection still open (after the in-flight limit). */
  closeAllConnections(): void;
}

// Starts the API (and, when webDist is set, the UI) on a Node HTTP server.
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const root = new Hono();
  root.route("/", options.app);
  if (options.webDist) {
    // Every UI file and deep link is one route, "/*": the path is never logged, since a deep
    // link can carry a Message-ID.
    root.use("/*", async (c, next) => {
      if (isApi(c.req.path)) return next();
      const started = performance.now();
      const requestId = randomUUID();
      await next();
      c.header("X-Request-Id", requestId);
      options.log.info("http.request", {
        requestId,
        method: c.req.method,
        route: "/*",
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      });
    });
    root.use("/*", serveStatic({ root: options.webDist }));
    // Single-page app: any other path gets index.html and the UI routes it.
    root.get("*", serveStatic({ root: options.webDist, path: "index.html" }));
  }

  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: root.fetch, hostname: options.hostname, port: options.port },
      (info: AddressInfo) => {
        const host = info.address.includes(":") ? `[${info.address}]` : info.address;
        const http = server as Server;
        let closing: Promise<void> | null = null;
        resolve({
          url: `http://${host}:${info.port}`,
          close: () => {
            closing ??= new Promise<void>((done, fail) => {
              http.close((err) => (err ? fail(err) : done()));
              http.closeIdleConnections();
            });
            return closing;
          },
          closeAllConnections: () => http.closeAllConnections(),
        });
      },
    );
    server.once("error", reject);
  });
}
