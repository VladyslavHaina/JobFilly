import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import type { AppEnv } from "./access/env";
import type { AppDeps } from "./deps";
import { healthRoutes } from "./routes/health";

// The HTTP API. The Node server and the tests mount this same app.
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  // Every request gets an id and one http.request line with the route pattern (never the path,
  // which can hold a Message-ID). API answers are never cached, so Back after sign-out shows
  // nothing.
  app.use("/api/*", async (c, next) => {
    const started = performance.now();
    const requestId = randomUUID();
    c.set("requestId", requestId);
    c.set("log", deps.log.child({ requestId }));
    c.set("user", undefined);
    c.set("sessionId", undefined);
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Request-Id", requestId);
    const user = c.get("user");
    const workspaceId = c.req.param("workspaceId");
    deps.log.info("http.request", {
      requestId,
      method: c.req.method,
      route: routePath(c),
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
      ...(user ? { userId: user.id } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    });
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    (c.get("log") ?? deps.log).error("http.error", { error });
    return c.json({ error: "internal", message: "Something went wrong" }, 500);
  });

  app.route("/api/health", healthRoutes(deps));

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  return app;
}

export type App = ReturnType<typeof createApp>;
