import {
  type Category,
  comparedForF53,
  type ExpectedFileMvp2,
  fixturesDir,
  isJobCategory,
  type JobFacts,
  type Persona,
  personaPaths,
  readJson,
} from "./format.ts";

// F5.3: with the fake AI, the category and facts the app stores for every analysed message equal
// expected.json. collectStored reads what the app serves for a workspace, compareWithExpected
// lists every message where that differs from the ground truth. The F5.3 proof,
// e2e/specs/mvp-1/99-f5.3-stored-equals-expected.spec.ts, runs both for Maria and Tom against the
// test stack and requires an empty list.

/**
 * One message as the app serves it: a row of GET /api/workspaces/:id/messages (MessageListItem
 * of packages/schema), with `roles` from its detail (MessageDetail) for job mail. `roles` is null
 * when no detail was read, as for not_job rows nobody corrected.
 */
export interface StoredMessage {
  id: string;
  category: Category | null;
  categorySource: "scan" | "you" | null;
  analysisStatus: "pending" | "done" | "failed";
  roles: JobFacts[] | null;
}

/** One way a stored message differs from expected.json. */
export interface Difference {
  messageId: string;
  /**
   * - message: listed by the app but not in expected.json, or (with `complete`) not listed;
   * - analysis: not analysed (with `complete`), or "Couldn't analyze" although the fake AI
   *   answers it validly;
   * - category, roles: the stored value differs from expected.json.
   */
  field: "message" | "analysis" | "category" | "roles";
  expected: unknown;
  stored: unknown;
}

export interface CompareOptions {
  /**
   * Every compared message must have been analysed: none missing, none still pending. Use it
   * after a full scan or after "Analyze them"; after a confident stop leave it off, and only the
   * messages analysed so far are compared.
   */
  complete?: boolean;
  /** Where expected.json is read from: fixturesDir() by default. */
  dir?: string;
}

/**
 * Every difference between the messages the app stores for `persona` and expected.json, over the
 * messages comparedForF53 selects: the not_job mail stage one sorts out and the job alerts'
 * roles included, own replies and the always-invalid message left out. A category a person
 * corrected (source "you", F5.4) is not the analysis's, so it is not compared; its roles are.
 * Roles are compared as a set of whole JobFacts objects, field by field; their order is not a
 * fact. An empty list means F5.3 holds for what has been analysed.
 *
 * From MVP 2 the mailbox also holds the mail `seed deliver` brought in, compared with its ground
 * truth in expected.json's `deliveries`. A run delivers it step by step, so `complete` never
 * requires it.
 */
export function compareWithExpected(
  persona: Persona,
  stored: readonly StoredMessage[],
  options: CompareOptions = {},
): Difference[] {
  const dir = options.dir ?? fixturesDir();
  const expected = readJson<ExpectedFileMvp2>(`${dir}${personaPaths(persona).expected}`);
  const differences: Difference[] = [];
  const seen = new Set<string>();
  for (const s of stored) {
    seen.add(s.id);
    const truth = expected.messages[s.id] ?? expected.deliveries[s.id];
    if (truth === undefined) {
      differences.push({ messageId: s.id, field: "message", expected: null, stored: s.id });
      continue;
    }
    if (!comparedForF53(truth)) continue;
    if (s.analysisStatus === "failed") {
      differences.push({
        messageId: s.id,
        field: "analysis",
        expected: "done",
        stored: s.analysisStatus,
      });
      continue;
    }
    if (s.analysisStatus === "pending") {
      if (options.complete) {
        differences.push({
          messageId: s.id,
          field: "analysis",
          expected: "done",
          stored: s.analysisStatus,
        });
      }
      continue;
    }
    if (s.categorySource !== "you" && s.category !== truth.category) {
      differences.push({
        messageId: s.id,
        field: "category",
        expected: truth.category,
        stored: s.category,
      });
    }
    differences.push(...compareRoles(s.id, truth.facts ?? [], s.roles, truth.category));
  }
  if (options.complete) {
    for (const [id, truth] of Object.entries(expected.messages)) {
      if (comparedForF53(truth) && !seen.has(id)) {
        differences.push({ messageId: id, field: "message", expected: id, stored: null });
      }
    }
  }
  return differences;
}

function compareRoles(
  messageId: string,
  expected: readonly JobFacts[],
  stored: readonly JobFacts[] | null,
  category: Category,
): Difference[] {
  // Job mail must come with its detail facts; not_job has none to read, so no detail is fine.
  if (stored === null) {
    return isJobCategory(category) ? [{ messageId, field: "roles", expected, stored }] : [];
  }
  const want = expected.map(canonical).sort();
  const got = stored.map(canonical).sort();
  if (want.length === got.length && want.every((w, i) => w === got[i])) return [];
  return [{ messageId, field: "roles", expected, stored }];
}

/** JSON with every object's keys sorted, so equal facts compare equal whatever the key order. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** Reads one API path as JSON, for example with Playwright's request context, signed in. */
export type GetJson = (path: string) => Promise<unknown>;

interface ListPage {
  items: Omit<StoredMessage, "roles">[];
  nextPage: number | null;
}

/**
 * Everything compareWithExpected needs from the app: every page of the workspace's messages with
 * non-job mail shown, and the roles from the detail of every job-category message and of every
 * message a person corrected. A correction (F5.4) changes only the category, so a job message
 * corrected to not_job keeps the roles its analysis found, and compareWithExpected still
 * compares them.
 */
export async function collectStored(get: GetJson, workspaceId: string): Promise<StoredMessage[]> {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/messages`;
  const stored: StoredMessage[] = [];
  for (let page: number | null = 1; page !== null; ) {
    const list = (await get(`${base}?showNonJob=true&page=${page}`)) as ListPage;
    if (!Array.isArray(list?.items)) throw new Error(`${base} page ${page}: no items`);
    for (const { id, category, categorySource, analysisStatus } of list.items) {
      let roles: JobFacts[] | null = null;
      if (categorySource === "you" || (category !== null && isJobCategory(category))) {
        const detail = (await get(`${base}/${encodeURIComponent(id)}`)) as { roles?: unknown };
        if (!Array.isArray(detail?.roles)) throw new Error(`${base}/${id}: no roles`);
        roles = detail.roles as JobFacts[];
      }
      stored.push({ id, category, categorySource, analysisStatus, roles });
    }
    page = list.nextPage;
  }
  return stored;
}
