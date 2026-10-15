import { hostname } from "node:os";
import { z } from "zod";

// All configuration comes from the environment (ARCHITECTURE › Configuration) and is checked at
// start. A missing or invalid variable stops the server with one clear message (F7.1).

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const required = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, { error: `${name} is required` });

const flag = (name: string) =>
  z
    .enum(["true", "false"], { error: `${name} must be "true" or "false"` })
    .default("false")
    .transform((v) => v === "true");

const positiveInt = (name: string, fallback: number) =>
  z
    .string()
    .default(String(fallback))
    .transform((v, ctx) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        ctx.addIssue({ code: "custom", message: `${name} must be a positive whole number` });
        return z.NEVER;
      }
      return n;
    });

const EnvSchema = z.object({
  DATABASE_URL: required("DATABASE_URL").refine((v) => /^postgres(ql)?:\/\//.test(v), {
    error: "DATABASE_URL must be a postgres:// connection string",
  }),
  JOBFILLY_SECRET_KEY: required("JOBFILLY_SECRET_KEY").transform((v, ctx) => {
    const key = Buffer.from(v, "base64");
    if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== v.replace(/=+$/, "")) {
      ctx.addIssue({
        code: "custom",
        message: "JOBFILLY_SECRET_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)",
      });
      return z.NEVER;
    }
    return new Uint8Array(key);
  }),
  PUBLIC_URL: required("PUBLIC_URL").transform((v, ctx) => {
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "PUBLIC_URL must be a URL such as https://jobfilly.home.lan",
      });
      return z.NEVER;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({ code: "custom", message: "PUBLIC_URL must start with http:// or https://" });
      return z.NEVER;
    }
    return url;
  }),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z
    .string()
    .default("8787")
    .transform((v, ctx) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 65535) {
        ctx.addIssue({ code: "custom", message: "PORT must be a whole number from 0 to 65535" });
        return z.NEVER;
      }
      return n;
    }),
  WEB_DIST: z.string().trim().min(1).optional(),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}` })
    .default("info"),
  JOBFILLY_SYNC_INTERVAL_SECONDS: positiveInt("JOBFILLY_SYNC_INTERVAL_SECONDS", 120),
  JOBFILLY_RDAP_URL: z
    .url({ error: "JOBFILLY_RDAP_URL must be a URL" })
    .default("https://rdap.org"),
  JOBFILLY_ALLOW_INSECURE_MAIL: flag("JOBFILLY_ALLOW_INSECURE_MAIL"),
});

export interface Config {
  databaseUrl: string;
  /** The 32-byte key for sealing secrets (secrets.ts). */
  secretKey: Uint8Array;
  publicUrl: URL;
  /** PUBLIC_URL's origin: state-changing requests must come from it. */
  origin: string;
  /** The session cookie gets Secure when PUBLIC_URL is https. */
  secureCookies: boolean;
  host: string;
  port: number;
  webDist: string | undefined;
  logLevel: LogLevel;
  syncIntervalSeconds: number;
  rdapUrl: string;
  allowInsecureMail: boolean;
  /** This replica's name in logs and job leases: the hostname. */
  instance: string;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; message: string };

/** Reads the configuration from `env`; on failure, the first problem in plain words. */
export function loadConfig(
  env: Record<string, string | undefined>,
  instance: string = hostname(),
): ConfigResult {
  // An empty variable counts as unset, so defaults apply and required ones say "is required".
  const present = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "invalid configuration" };
  }
  const e = parsed.data;
  return {
    ok: true,
    config: {
      databaseUrl: e.DATABASE_URL,
      secretKey: e.JOBFILLY_SECRET_KEY,
      publicUrl: e.PUBLIC_URL,
      origin: e.PUBLIC_URL.origin,
      secureCookies: e.PUBLIC_URL.protocol === "https:",
      host: e.HOST,
      port: e.PORT,
      webDist: e.WEB_DIST,
      logLevel: e.LOG_LEVEL,
      syncIntervalSeconds: e.JOBFILLY_SYNC_INTERVAL_SECONDS,
      rdapUrl: e.JOBFILLY_RDAP_URL,
      allowInsecureMail: e.JOBFILLY_ALLOW_INSECURE_MAIL,
      instance,
    },
  };
}
