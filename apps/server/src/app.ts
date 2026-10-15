import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { type AppEnv, originCheck, type WorkspaceEnv, workspaceMember } from "./access";
import { requireUser, sessionMiddleware } from "./auth/session";
import type { AppDeps } from "./deps";
import { eventsRoutes } from "./live";
import { aiRoutes } from "./routes/ai";
import { assistantRoutes } from "./routes/assistant";
import { authRoutes } from "./routes/auth";
import { cvsRoutes } from "./routes/cvs";
import { decisionsRoutes } from "./routes/decisions";
import { draftsRoutes } from "./routes/drafts";
import { healthRoutes } from "./routes/health";
import { historyRoutes } from "./routes/history";
import { intakeRoutes } from "./routes/intake";
import { invitesRoutes } from "./routes/invites";
import { mailboxRoutes } from "./routes/mailboxes";
import { messageRoutes } from "./routes/messages";
import { profileRoutes } from "./routes/profiles";
import { rulesRoutes } from "./routes/rules";
import { scanRoutes } from "./routes/scans";
import { sendersRoutes } from "./routes/senders";
import { membersRoutes, workspaceInvitesRoutes, workspacesRoutes } from "./routes/workspaces";

/** A workspace route module: mounted once at /api/workspaces/:workspaceId/<name>. */
export type WorkspaceRoutes = (deps: AppDeps) => Hono<WorkspaceEnv>;

// The HTTP API. The Node server and the tests mount this same app.
//
// Every /api request passes, in order: the request context (id, logger, http.request line), the
// Origin check for state-changing methods, and the session. Everything under
// /api/workspaces/:workspaceId/ also needs a signed-in member of that workspace (else 404). Roles
// are not applied here: each route module calls requireRole on its own handlers (else 403).
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  // http.request carries the route pattern, never the path (which can hold a Message-ID). API
  // answers are never cached, so Back after sign-out shows nothing.
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
  app.use("/api/*", originCheck(deps.config.origin));
  app.use("/api/*", sessionMiddleware(deps));

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    (c.get("log") ?? deps.log).error("http.error", { error });
    return c.json({ error: "internal", message: "Something went wrong" }, 500);
  });

  app.route("/api/health", healthRoutes(deps));
  app.route("/api/auth", authRoutes(deps));
  app.route("/api/invites", invitesRoutes(deps));
  app.route("/api/workspaces", workspacesRoutes(deps));

  const workspace = app.basePath("/api/workspaces/:workspaceId");
  workspace.use("/*", requireUser, workspaceMember(deps));
  const mount = (name: string, routes: WorkspaceRoutes) =>
    workspace.route(`/${name}`, routes(deps));
  mount("members", membersRoutes);
  mount("invites", workspaceInvitesRoutes);
  mount("events", (d) => eventsRoutes(d));
  mount("mailboxes", mailboxRoutes);
  mount("ai", aiRoutes);
  mount("scans", scanRoutes);
  mount("messages", messageRoutes);
  mount("intake", intakeRoutes);
  mount("profiles", profileRoutes);
  // MVP 2. Rules and the history live under /profiles/:profileId next to the profile routes.
  mount("profiles", rulesRoutes);
  mount("profiles", historyRoutes);
  mount("cvs", cvsRoutes);
  mount("senders", sendersRoutes);
  mount("drafts", draftsRoutes);
  mount("decisions", decisionsRoutes);
  mount("assistant", assistantRoutes);

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  return app;
}

export type App = ReturnType<typeof createApp>;
