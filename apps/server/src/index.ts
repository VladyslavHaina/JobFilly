import { hostname } from "node:os";
import { openDatabase } from "@jobfilly/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDeps } from "./deps";
import { createLogger } from "./log";
import { startServer } from "./node";
import { sweep } from "./pipeline/sweep";
import { shutdown } from "./shutdown";
import { createScheduler } from "./sync/scheduler";

// The server process. `node dist/index.js` serves the API and the UI; `node dist/index.js
// migrate` only applies the migrations (a Kubernetes migration job) and exits.

const configResult = loadConfig(process.env);
if (!configResult.ok) {
  // One clear message, as a JSON log line like every other line (F7.1).
  createLogger({ level: "info", instance: hostname() }).fatal("config.invalid", {
    message: configResult.message,
  });
  process.exit(1);
}
const config = configResult.config;
const log = createLogger({ level: config.logLevel, instance: config.instance });
const connection = openDatabase(config.databaseUrl, {
  onError: (error) => log.warn("db.connection_error", { error }),
});

async function migrate(): Promise<void> {
  const { applied } = await connection.migrate();
  if (applied > 0) log.info("db.migrated", { applied });
}

if (process.argv[2] === "migrate") {
  try {
    await migrate();
    await connection.close();
    process.exit(0);
  } catch (error) {
    log.fatal("db.connection_error", { error });
    process.exit(1);
  }
}

const deps = createDeps({ config, connection, log });
const scheduler = createScheduler(deps);
const server = await startServer({
  app: createApp(deps),
  hostname: config.host,
  port: config.port,
  webDist: config.webDist,
  log,
}).catch((error: unknown) => {
  log.fatal("server.stopped", { error });
  process.exit(1);
});

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    stopping = true;
    void shutdown({
      health: deps.health,
      log,
      server,
      live: deps.live,
      queue: deps.queue,
      background: deps.background,
      scheduler,
      closeDatabase: () => connection.close(),
    }).then(
      () => process.exit(0),
      (error) => {
        log.fatal("server.shutting_down", { error });
        process.exit(1);
      },
    );
  });
}

// Readiness stays 503 until the database is reachable and migrated; until then keep trying.
for (;;) {
  if (stopping) break;
  try {
    await migrate();
    await deps.live.start();
    break;
  } catch (error) {
    log.warn("db.connection_error", { error });
    await new Promise((r) => setTimeout(r, 2000));
  }
}
if (!stopping) {
  // One sweep at startup: a deployment whose profile was confirmed before MVP 2 ran gets its
  // backlog evaluated without anyone doing anything (F1.6); then one every sync interval.
  await sweep(deps).catch((error: unknown) => log.warn("pipeline.sweep_failed", { error }));
  deps.queue.start();
  scheduler.start();
  log.info("server.ready", { url: server.url });
}
