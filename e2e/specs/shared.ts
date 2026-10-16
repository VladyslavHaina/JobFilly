import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { type APIRequest, type APIRequestContext, expect, type Page } from "@playwright/test";
import { type CoreKey, PERSONA_ADDRESSES, type Persona } from "../fixtures/format.ts";
import { COMPOSE_FILE, fileState } from "../stack.ts";

// What every MVP's scenario specs share: the running test stack (its compose project, the
// replicas' direct ports and JSON logs), the personas' sign-in, the probes' API sessions and the
// app's own words for the intake questions. Not a spec itself: Playwright runs only *.spec.ts.

/** The repository root: compose runs from there, as stack.ts does. */
export const ROOT = resolve(import.meta.dirname, "../..");
/** The running stack's compose project: the one stack.ts passes on, else e2e/.stack's. */
const project = process.env.JOBFILLY_E2E_PROJECT ?? fileState(join(ROOT, "e2e", ".stack")).read();

export const REPLICAS = ["app-a", "app-b"] as const;
export type Replica = (typeof REPLICAS)[number];
/** Each replica's direct port on the test stack's proxy, for read-only views and health. */
export const DIRECT_PORTS: Record<Replica, number> = { "app-a": 8081, "app-b": 8082 };
/** The proxy's own port, where the start URL is. */
export const PROXY_PORT = 8080;

/** The replica of this name, if it is one. */
export const replicaNamed = (name: unknown): Replica | undefined =>
  REPLICAS.find((replica) => replica === name);

/** The personas' login passwords, the ones S1 and S6 of MVP 1 register them with. */
export const LOGIN_PASSWORDS: Record<Persona, string> = {
  maria: "E2E-SECRET-maria-login",
  tom: "E2E-SECRET-tom-login",
};
/** The fake AI as the personas set it up (S2 and S7 of MVP 1), and the key they type. */
export const FAKE_AI_URL = "http://fake-ai:8080/v1";
export const AI_KEY = "E2E-SECRET-ai-key";

/** The intake form's label of each core question (the app's own words). */
export const INTAKE_LABELS: Record<CoreKey, string> = {
  target_roles: "Roles you're looking for",
  seniority: "Seniority",
  places: "Places you'd work onsite or hybrid",
  remote: "Remote work",
  contracts: "Contracts",
  min_pay: "Minimum pay",
  languages: "Working languages",
  work_permits: "Work permits",
  reply_to: "Mail that should get a reply",
  deal_breakers: "Deal-breakers",
};

/** `docker compose` arguments on the running stack's project. */
export function composeArgs(args: string[]): string[] {
  if (!project) throw new Error('No test stack is up: start one with "pnpm e2e:stack up"');
  return ["compose", "-p", project, "-f", COMPOSE_FILE, ...args];
}

/** Runs `docker compose` on the running stack and returns what it printed. */
export function compose(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("docker", composeArgs(args), {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
}

export type LogLine = { event?: unknown; instance?: unknown; [field: string]: unknown };

/** Every JSON line a service of the stack has logged so far. */
export function serviceLog(service: string): LogLine[] {
  return compose(["logs", "--no-color", "--no-log-prefix", service])
    .split("\n")
    .flatMap((line) => {
      try {
        return line.startsWith("{") ? [JSON.parse(line) as LogLine] : [];
      } catch {
        return [];
      }
    });
}

/** Where each replica's log is now, for eventsSince. */
export const logMark = (): number[] => REPLICAS.map((replica) => serviceLog(replica).length);

/** The events both replicas logged since `mark`. */
export const eventsSince = (mark: number[]): unknown[] =>
  REPLICAS.flatMap((replica, i) =>
    serviceLog(replica)
      .slice(mark[i])
      .map((l) => l.event),
  );

/** Every line both replicas logged with this event and these fields. */
export const logged = (event: string, fields: Record<string, unknown>): LogLine[] =>
  REPLICAS.flatMap(serviceLog).filter(
    (l) => l.event === event && Object.entries(fields).every(([k, v]) => l[k] === v),
  );

/** The status of /api/health/ready on this port, or null when nothing answers in time. */
export async function ready(port: number): Promise<number | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
      // Longer than the replicas' 5-second database connection timeout.
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch {
    return null;
  }
}

/** Fills in and sends the sign-in form the page shows. */
export async function submitSignIn(page: Page, persona: Persona) {
  await page.getByLabel("Email").fill(PERSONA_ADDRESSES[persona]);
  await page.getByLabel("Password").fill(LOGIN_PASSWORDS[persona]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** The tabs of Settings, as its navigation names them. */
type SettingsTab = "Mailbox" | "AI";

/**
 * Opens a tab of Settings through the Main navigation, as an admin does. Every role here is
 * found by its exact name: Playwright otherwise matches names as case-insensitive substrings, and
 * "AI" alone also finds "Mailbox" (m-ai-lbox), a strict-mode error that left MVP 1 unconfigured.
 */
export async function openSettingsTab(page: Page, name: SettingsTab) {
  await page
    .getByRole("navigation", { name: "Main", exact: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  const tab = page
    .getByRole("navigation", { name: "Settings", exact: true })
    .getByRole("link", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-current", "page");
}

/** Opens the start page, the one URL a person types, and signs in there. */
export async function signIn(page: Page, persona: Persona) {
  await page.goto("/");
  await submitSignIn(page, persona);
}

/** The workspace the page is in, from its address (/w/<id>/…). */
export const workspaceIdOf = (page: Page): string =>
  new URL(page.url()).pathname.split("/")[2] ?? "";

/** Opens a message of the job inbox by finding its subject with the search field. */
export async function openMessage(page: Page, subject: string) {
  await page.getByLabel("Search sender or subject").fill(subject);
  await page
    .getByRole("list", { name: "Messages", exact: true })
    .getByRole("link")
    .filter({ hasText: subject })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: subject, level: 2, exact: true })).toBeVisible();
}

/** A probe's API context on the start URL's origin, sending that Origin as a browser would. */
export async function apiContext(
  request: APIRequest,
  baseURL: string | undefined,
): Promise<APIRequestContext> {
  const origin = new URL(baseURL ?? `http://127.0.0.1:${PROXY_PORT}`).origin;
  return request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
}

/** Signs a probe's context in as the persona, with a session of its own. */
export async function apiSignIn(api: APIRequestContext, persona: Persona) {
  const response = await api.post("/api/auth/sign-in", {
    data: { email: PERSONA_ADDRESSES[persona], password: LOGIN_PASSWORDS[persona] },
  });
  expect(response.status(), `${persona} signs in`).toBe(200);
}

/**
 * Runs `body`, then `cleanup` whatever happened, so the stack is left as later specs expect. A
 * failing cleanup fails the test only when `body` passed: it never hides why `body` failed.
 */
export async function withCleanup(body: () => Promise<void>, cleanup: () => Promise<void>) {
  try {
    await body();
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }
  await cleanup();
}
