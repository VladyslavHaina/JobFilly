import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import {
  type AppEnv,
  originCheck,
  requireFullAccess,
  requireJobMail,
  type WorkspaceEnv,
  workspaceMember,
} from "./access";
import { requireUser, sessionMiddleware } from "./auth/session";
import type { AppDeps } from "./deps";
import { eventsRoutes } from "./live";
import { accountRoutes } from "./routes/account";
import { activityRoutes } from "./routes/activity";
import { aiRoutes } from "./routes/ai";
import { assignmentRoutes } from "./routes/assignments";
import { assistantRoutes } from "./routes/assistant";
import { authRoutes } from "./routes/auth";
import { cvsRoutes } from "./routes/cvs";
import { decisionsRoutes } from "./routes/decisions";
import { draftsRoutes } from "./routes/drafts";
import { exportRoutes } from "./routes/export";
import { healthRoutes } from "./routes/health";
import { historyRoutes } from "./routes/history";
import { intakeRoutes } from "./routes/intake";
import { invitesRoutes } from "./routes/invites";
import { mailboxRoutes } from "./routes/mailboxes";
import { messageRoutes } from "./routes/messages";
import { oauthPublicRoutes, oauthRoutes } from "./routes/oauth";
import { pipelineRoutes } from "./routes/pipeline";
import { profileRoutes } from "./routes/profiles";
import { rulesRoutes } from "./routes/rules";
import { scanRoutes } from "./routes/scans";
import { sendRoutes } from "./routes/send";
import { sendersRoutes } from "./routes/senders";
import { smtpRoutes } from "./routes/smtp";
import { workspaceRoutes } from "./routes/workspace";
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
  // MVP 3: the signed-in user's account (F7.3), and Google sign-in's callback and providers
  // (F3.2), whose URL can't name a workspace.
  app.route("/api/account", accountRoutes(deps));
  app.route("/api/oauth", oauthPublicRoutes(deps));

  const workspace = app.basePath("/api/workspaces/:workspaceId");
  workspace.use("/*", requireUser, workspaceMember(deps));
  // A member who sees the job pipeline only (MVP 3, F6.1, F6.2) gets 404 from every route about a
  // message that isn't job mail, reads and writes alike, whichever module serves it.
  const jobMail = requireJobMail(deps);
  workspace.use("/messages/:messageId", jobMail);
  workspace.use("/messages/:messageId/*", jobMail);
  workspace.use("/senders/messages/:messageId/*", jobMail);
  /**
   * Mounts a route module. Such a member gets 404 from a whole module, before any handler runs,
   * unless it is mounted with `pipeline: true`: so a new module is closed to them by default, and
   * one that opens to them shows them only what F6.1 allows (no message bodies, drafts or
   * non-job mail).
   */
  const mount = (name: string, routes: WorkspaceRoutes, options: { pipeline?: boolean } = {}) => {
    if (options.pipeline) return workspace.route(`/${name}`, routes(deps));
    const guarded = new Hono<WorkspaceEnv>();
    guarded.use("*", requireFullAccess());
    guarded.route("/", routes(deps));
    return workspace.route(`/${name}`, guarded);
  };
  const open = { pipeline: true };
  mount("members", membersRoutes, open);
  mount("invites", workspaceInvitesRoutes, open);
  mount("events", (d) => eventsRoutes(d), open);
  mount("mailboxes", mailboxRoutes, open);
  mount("ai", aiRoutes, open);
  mount("scans", scanRoutes, open);
  // Job mail only for such a member (the list filters it, requireJobMail guards the rest), never
  // a body (the body route requires full access).
  mount("messages", messageRoutes, open);
  mount("intake", intakeRoutes, open);
  mount("profiles", profileRoutes, open);
  // MVP 2. Rules and the history live under /profiles/:profileId next to the profile routes.
  mount("profiles", rulesRoutes, open);
  mount("profiles", historyRoutes, open);
  mount("cvs", cvsRoutes, open);
  mount("senders", sendersRoutes, open);
  // Mail content: closed to a member who sees the pipeline only.
  mount("drafts", draftsRoutes);
  mount("decisions", decisionsRoutes, open);
  // Open, with the member's access applied inside: no message text for such a member (F8.3).
  mount("assistant", assistantRoutes, open);
  // MVP 3. Each module is registered here ahead of the slice that builds it (its plan).
  mount("messages", assignmentRoutes, open);
  mount("mailboxes", smtpRoutes, open);
  mount("oauth", oauthRoutes, open);
  mount("pipeline", pipelineRoutes, open);
  mount("activity", activityRoutes, open);
  // Mail content, or all of it: closed to a member who sees the pipeline only.
  mount("drafts", sendRoutes);
  mount("export", exportRoutes);
  // DELETE /api/workspaces/:workspaceId itself (F7.2).
  mount("", workspaceRoutes, open);

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  return app;
}

export type App = ReturnType<typeof createApp>;
