import { execFile, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import {
  type APIRequest,
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { DELIVERIES, type DeliverySource } from "../fixtures/build/deliveries.ts";
import {
  type CoreKey,
  type CvFixture,
  type DeliveryEntry,
  fixturesDir,
  PERSONA_ADDRESSES,
  type Persona,
  personaPathsMvp2,
  readJson,
} from "../fixtures/format.ts";
import type { DraftsReport, SmtpReport } from "../seed/commands.ts";
import { COMPOSE_FILE, fileState } from "../stack.ts";

// What every MVP's scenario specs share: the running test stack (its compose project, the
// replicas' direct ports and JSON logs), the personas' sign-in, the probes' API sessions and the
// app's own words for the intake questions; from MVP 2 the seed's deliveries and verification
// steps, the message detail's parts and the assistant. Not a spec itself: Playwright runs only
// *.spec.ts.

/** The repository root: compose runs from there, as stack.ts does. */
export const ROOT = resolve(import.meta.dirname, "../..");
/** The running stack's compose project: the one stack.ts passes on, else e2e/.stack's. */
const project = process.env.JOBFILLY_E2E_PROJECT ?? fileState(join(ROOT, "e2e", ".stack")).read();

/** The app's replicas: three from MVP 3 (F10.1), so every log read covers app-c too. */
export const REPLICAS = ["app-a", "app-b", "app-c"] as const;
export type Replica = (typeof REPLICAS)[number];
/** Each replica's direct port on the test stack's proxy, for read-only views and health. */
export const DIRECT_PORTS: Record<Replica, number> = {
  "app-a": 8081,
  "app-b": 8082,
  "app-c": 8083,
};
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

/** Where each replica's log is now, for eventsSince and logSince. */
export const logMark = (): number[] => REPLICAS.map((replica) => serviceLog(replica).length);

/** Every line the replicas logged since `mark`, app-a's first. */
export const logSince = (mark: number[]): LogLine[] =>
  REPLICAS.flatMap((replica, i) => serviceLog(replica).slice(mark[i]));

/** The events the replicas logged since `mark`. */
export const eventsSince = (mark: number[]): unknown[] => logSince(mark).map((l) => l.event);

/**
 * The lines at level error or fatal since `mark`: a scenario expects none unless it provokes
 * them (docs/mvp/README.md › Watch the logs).
 */
export const errorsSince = (mark: number[]): LogLine[] =>
  logSince(mark).filter((l) => l.level === "error" || l.level === "fatal");

/** Every replica's whole log as written, JSON or not, for the leak checks. */
export const replicaLogText = (): string =>
  compose(["logs", "--no-color", "--no-log-prefix", ...REPLICAS]);

/** Every line the replicas logged with this event and these fields. */
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

// The proxy (docker/proxy/haproxy.cfg) health-checks each replica every second and takes it out
// after 2 failed checks, so for a moment after a replica stops answering the proxy still sends it
// requests, and a few requests that happen to answer prove nothing. These helpers go by the
// proxy's own log instead: its health-check verdicts ("Server replicas/app-a is DOWN, …") and its
// request lines, which name the server that answered each one.

/** The proxy's log as it wrote it. */
const proxyLog = (): string[] =>
  compose(["logs", "--no-color", "--no-log-prefix", "proxy"]).split("\n");

/** Where the proxy's log is now, for waitProxyDrops. */
export const proxyMark = (): number => proxyLog().length;

/** Requests per round when checking where the proxy routes: enough to cover a round-robin. */
const ROUTING_ROUND = 10;

/**
 * Sends ROUTING_ROUND requests through the proxy, one after another, and returns the replica the
 * proxy's log says answered each with 200; undefined where none did.
 */
async function servedThroughProxy(): Promise<(Replica | undefined)[]> {
  const tag = randomUUID();
  const answered: boolean[] = [];
  for (let i = 0; i < ROUTING_ROUND; i++) {
    answered.push(
      await fetch(`http://127.0.0.1:${PROXY_PORT}/api/health/ready?probe=${tag}-${i}`, {
        // A replica that is paused but still in the round-robin never answers.
        signal: AbortSignal.timeout(2_000),
      }).then(
        (r) => r.status === 200,
        () => false,
      ),
    );
  }
  const serverOf = (log: string[], i: number): Replica | undefined => {
    const line = log.find((l) => l.includes(`?probe=${tag}-${i} HTTP/`));
    return replicaNamed(line?.match(/ balanced replicas\/(\S+) \S+ 200 /)?.[1]);
  };
  // The proxy logs a request once it has answered it: give its log a moment to catch up.
  for (let tries = 0; ; tries++) {
    const log = proxyLog();
    const servers = answered.map((ok, i) => (ok ? serverOf(log, i) : undefined));
    if (tries >= 10 || servers.every((s, i) => s || !answered[i])) return servers;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Waits until the proxy has taken `replica` out of its round-robin: since `mark` (proxyMark(),
 * taken before the replica was stopped or paused) its health checks have last called it DOWN,
 * and then ROUTING_ROUND requests in a row all go to the other replicas and answer.
 */
export async function waitProxyDrops(replica: Replica, mark: number) {
  const verdict = new RegExp(`Server replicas/${replica} (?:\\('${replica}'\\) )?is (UP|DOWN)`);
  const lastVerdict = () =>
    proxyLog()
      .slice(mark)
      .map((l) => l.match(verdict)?.[1])
      .filter(Boolean)
      .at(-1);
  await expect.poll(lastVerdict, { timeout: 60_000, intervals: [1_000] }).toBe("DOWN");
  await expect
    .poll(async () => (await servedThroughProxy()).every((s) => s && s !== replica), {
      timeout: 60_000,
      intervals: [1_000],
    })
    .toBe(true);
}

/**
 * Waits until the proxy routes requests to `replica` again: one of a round of requests through
 * the proxy is answered by it. Its direct port answering isn't enough: the proxy adds it back
 * only after its next health check passes.
 */
export async function waitProxyRoutesTo(replica: Replica) {
  await expect
    .poll(async () => (await servedThroughProxy()).includes(replica), {
      timeout: 180_000,
      intervals: [1_000],
    })
    .toBe(true);
}

/** Fills in and sends the sign-in form the page shows. */
export async function submitSignIn(page: Page, persona: Persona) {
  await page.getByLabel("Email").fill(PERSONA_ADDRESSES[persona]);
  await page.getByLabel("Password").fill(LOGIN_PASSWORDS[persona]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** The pages of a workspace, as the Main navigation names them. */
type MainPage = "Inbox" | "Drafts" | "Decisions" | "Profile" | "CVs" | "Members";

/**
 * Opens a page of the workspace through the Main navigation. Decisions carries the open count
 * once there is one (its name is then "Decisions 2 open decisions"), so it alone is found by a
 * pattern that allows that count and nothing else.
 */
export async function openPage(page: Page, name: MainPage) {
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const link =
    name === "Decisions"
      ? nav.getByRole("link", { name: /^Decisions\s*(\d+ open decisions?)?$/ })
      : nav.getByRole("link", { name, exact: true });
  await link.click();
  await expect(link).toHaveAttribute("aria-current", "page");
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

// --- MVP 2 -----------------------------------------------------------------------------------

const SEED_RUN = ["run", "--rm", "--no-deps", "-T", "seed"];

/**
 * Runs a seed command on the running stack (`docker compose run --rm seed …`, the infrastructure
 * and verification steps of docs/mvp/MVP-2.md) and returns what it printed. The seed only needs
 * the imap service, which is up, so nothing else is started.
 */
export function seed(args: string[]): string {
  return compose([...SEED_RUN, ...args]);
}

/** seed, without holding up the test while it runs: a log being followed keeps up meanwhile. */
export async function seedInBackground(args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)("docker", composeArgs([...SEED_RUN, ...args]), {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  return stdout;
}

/** The JSON a seed command printed (reset-uidvalidity prints a line of text before it). */
const seedJson = <T>(printed: string): T => JSON.parse(printed.slice(printed.indexOf("{"))) as T;

/** `seed inspect drafts <persona>`: the persona's Drafts folder. */
export const inspectDrafts = (persona: Persona): DraftsReport =>
  seedJson<DraftsReport>(seed(["inspect", "drafts", persona]));

/** `seed inspect smtp`: what reached the mail server over SMTP. */
export const inspectSmtp = (): SmtpReport => seedJson<SmtpReport>(seed(["inspect", "smtp"]));

type MailboxDraft = DraftsReport["drafts"][number];

/** The drafts in the Drafts folder that reply to this Message-ID. */
export const repliesTo = (report: DraftsReport, messageId: string): MailboxDraft[] =>
  report.drafts.filter((d) => d.inReplyTo?.trim() === messageId);

/** A message `seed deliver <id>` brings into Maria's Inbox: its source and its Message-ID. */
export type Delivery = DeliverySource & { messageId: string };

const deliveryEntries = readJson<DeliveryEntry[]>(
  `${fixturesDir()}${personaPathsMvp2("maria").deliveries}`,
);

/** The delivery of this id (deliveries.json), with what the generator wrote it from. */
export function delivery(id: string): Delivery {
  const source = DELIVERIES.find((d) => d.id === id);
  const entry = deliveryEntries.find((d) => d.id === id);
  if (!source || !entry) throw new Error(`${id} is not one of Maria's deliveries`);
  return { ...source, messageId: entry.messageId };
}

/** Every delivery of a scenario step ("S2" is the batch `seed deliver S2` brings). */
export const deliveriesOf = (step: DeliverySource["step"]): Delivery[] =>
  DELIVERIES.filter((d) => d.step === step).map((d) => delivery(d.id));

const cvFixtures = (persona: Persona) =>
  readJson<CvFixture[]>(`${fixturesDir()}${personaPathsMvp2(persona).cvList}`);

/** A persona's CV files, as the file picker is given them. */
export const cvFiles = (persona: Persona): string[] =>
  cvFixtures(persona).map((cv) => `${fixturesDir()}${personaPathsMvp2(persona).cvs}/${cv.file}`);

/**
 * The name the app gives the persona's CV of this fixture name ("Backend (DE)"): the CVs page
 * asks for no name, so a CV is named after its file without the extension ("backend-de").
 */
export function cvName(persona: Persona, fixtureName: string): string {
  const cv = cvFixtures(persona).find((c) => c.name === fixtureName);
  if (!cv) throw new Error(`${persona} has no CV named ${fixtureName}`);
  return cv.file.replace(/\.[^.]+$/, "");
}

/** The parts of one role of the open message, as the message detail names them. */
export function roleParts(page: Page, position = 1) {
  return {
    facts: page.getByRole("region", { name: `Role ${position}`, exact: true }),
    fit: page.getByRole("region", { name: `Fit for role ${position}`, exact: true }),
    cv: page.getByRole("region", { name: `CV for role ${position}`, exact: true }),
    draft: page.getByRole("region", { name: `Reply draft for role ${position}`, exact: true }),
  };
}

/** A fit score chip's name while its score is current (not "out of date: being updated"). */
const CURRENT_FIT = /^Fit score (\d+)(, capped at 40 by a conflict)?$/;

/** The current fit score shown in `scope` (an inbox row or a role's match panel). */
export async function fitScore(scope: Locator): Promise<{ score: number; capped: boolean }> {
  const chip = scope.getByRole("img", { name: /^Fit score \d+(, capped at 40 by a conflict)?$/ });
  await expect(chip).toBeVisible({ timeout: 60_000 });
  const [, score, capped] = CURRENT_FIT.exec((await chip.getAttribute("aria-label")) ?? "") ?? [];
  return { score: Number(score), capped: capped !== undefined };
}

/** The row of the job inbox with this subject. */
export const inboxRow = (page: Page, subject: string): Locator =>
  page
    .getByRole("list", { name: "Messages", exact: true })
    .getByRole("link")
    .filter({ hasText: subject });

/** The Assistant panel, opened with the button every page has (F8.1). */
export async function openAssistant(page: Page): Promise<Locator> {
  const panel = page.getByRole("dialog", { name: "Assistant", exact: true });
  if ((await panel.count()) === 0) {
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Types a message to the assistant and sends it. The "Thinking…" state shows until the reply
 * comes (F8.9); it is watched from before the send, as with the fake AI it lasts about 300 ms.
 */
export async function askAssistant(panel: Locator, text: string) {
  await panel.getByRole("textbox", { name: "Message", exact: true }).fill(text);
  const thinking = panel.getByText("Thinking…", { exact: true }).waitFor({ timeout: 5_000 });
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await thinking;
}

/**
 * Values one spec records for a later one on the same stack: an id the browser saw in one
 * scenario that a probe of another needs. Kept beside the stack's project name in e2e/.stack,
 * which `pnpm e2e:stack down` removes, and read back only for that same project.
 */
const RUN_STATE = join(ROOT, "e2e", ".stack", "run-state.json");

function runState(): Record<string, string> {
  try {
    const state = JSON.parse(readFileSync(RUN_STATE, "utf8")) as {
      project?: string;
      values?: Record<string, string>;
    };
    return state.project === project ? (state.values ?? {}) : {};
  } catch {
    return {};
  }
}

export function remember(key: string, value: string) {
  const values = { ...runState(), [key]: value };
  mkdirSync(dirname(RUN_STATE), { recursive: true });
  writeFileSync(RUN_STATE, `${JSON.stringify({ project, values })}\n`);
}

export function recall(key: string): string {
  const value = runState()[key];
  if (!value) throw new Error(`${key} wasn't recorded on this stack: its scenario runs first`);
  return value;
}

/** Both replicas' log lines from the moment followLogs is called, as they are written. */
interface FollowedLogs {
  lines: LogLine[];
  /**
   * The first line from index `from` on, already logged or still to come, that `pick` takes.
   * `pick` runs as each line arrives, so whatever the caller does next starts at once.
   */
  next(pick: (line: LogLine) => boolean, timeoutMs: number, from?: number): Promise<LogLine>;
  stop(): void;
}

export function followLogs(): FollowedLogs {
  const lines: LogLine[] = [];
  const waiters = new Set<(line: LogLine, index: number) => void>();
  const child = spawn(
    "docker",
    composeArgs(["logs", "--follow", "--no-color", "--no-log-prefix", "--tail", "0", ...REPLICAS]),
    { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] },
  );
  createInterface({ input: child.stdout }).on("line", (text) => {
    if (!text.startsWith("{")) return;
    let line: LogLine;
    try {
      line = JSON.parse(text) as LogLine;
    } catch {
      return;
    }
    lines.push(line);
    for (const waiter of [...waiters]) waiter(line, lines.length - 1);
  });
  return {
    lines,
    next(pick, timeoutMs, from = 0) {
      const found = lines.slice(from).find(pick);
      if (found) return Promise.resolve(found);
      return new Promise((done, fail) => {
        const waiter = (line: LogLine, index: number) => {
          if (index < from || !pick(line)) return;
          clearTimeout(timer);
          waiters.delete(waiter);
          done(line);
        };
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          fail(new Error(`No such log line within ${timeoutMs / 1000} s`));
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
    stop: () => child.kill(),
  };
}
