import { describe, expect, it } from "vitest";
import { collectStored, compareWithExpected, type GetJson, type StoredMessage } from "./compare.ts";
import {
  comparedForF53,
  type ExpectedFile,
  type ExpectedFileMvp2,
  fixturesDir,
  isJobCategory,
  type JobFacts,
  MARIA_KEY_MESSAGES,
  PERSONAS,
  type Persona,
  personaPaths,
  readJson,
} from "./format.ts";

function expectedFile(persona: Persona): ExpectedFile {
  return readJson<ExpectedFile>(`${fixturesDir()}${personaPaths(persona).expected}`);
}

/**
 * What a correct app serves after analysing everything: every compared message as expected.json
 * says, the always-invalid one "Couldn't analyze", own replies not listed (as the job inbox does).
 */
function storedFromExpected(persona: Persona): StoredMessage[] {
  const stored: StoredMessage[] = [];
  for (const [id, t] of Object.entries(expectedFile(persona).messages)) {
    if (t.ownReply) continue;
    if (t.invalid) {
      stored.push({
        id,
        category: null,
        categorySource: null,
        analysisStatus: "failed",
        roles: null,
      });
      continue;
    }
    stored.push({
      id,
      category: t.category,
      categorySource: "scan",
      analysisStatus: "done",
      roles: isJobCategory(t.category) ? structuredClone(t.facts ?? []) : null,
    });
  }
  return stored;
}

function find(stored: StoredMessage[], id: string): StoredMessage {
  const s = stored.find((m) => m.id === id);
  if (s === undefined) throw new Error(`no stored message ${id}`);
  return s;
}

/** The first analysed message with a role matching `has`, and that role. */
function withRole(stored: StoredMessage[], has: (r: JobFacts) => boolean) {
  for (const s of stored) {
    const role = s.analysisStatus === "done" ? s.roles?.find(has) : undefined;
    if (role !== undefined) return { s, role };
  }
  throw new Error("no such role in the fixtures");
}

describe("compareWithExpected (F5.3)", () => {
  it.each(PERSONAS)("finds nothing when %s's stored messages equal expected.json", (persona) => {
    const stored = storedFromExpected(persona);
    expect(stored.filter((s) => s.analysisStatus === "done").length).toBeGreaterThan(10);
    expect(compareWithExpected(persona, stored, { complete: true })).toEqual([]);
  });

  it("compares the not_job mail stage one sorts out and every job alert's roles", () => {
    const compared = Object.values(expectedFile("maria").messages).filter(comparedForF53);
    expect(compared.some((t) => t.stageOne === "not_job")).toBe(true);
    expect(compared.some((t) => t.category === "job_alert" && (t.facts ?? []).length > 1)).toBe(
      true,
    );
  });

  it("ignores key order and role order, which are no facts", () => {
    const stored = storedFromExpected("maria");
    const alert = find(stored, MARIA_KEY_MESSAGES.multiRoleAlert);
    expect(alert.roles?.length).toBeGreaterThan(1);
    alert.roles = (alert.roles as JobFacts[])
      .map((r) => Object.fromEntries(Object.entries(r).reverse()) as unknown as JobFacts)
      .reverse();
    expect(compareWithExpected("maria", stored)).toEqual([]);
  });

  it("reports a flipped category", () => {
    const stored = storedFromExpected("maria");
    find(stored, MARIA_KEY_MESSAGES.interviewInvite).category = "rejection";
    expect(compareWithExpected("maria", stored)).toEqual([
      {
        messageId: MARIA_KEY_MESSAGES.interviewInvite,
        field: "category",
        expected: "interview",
        stored: "rejection",
      },
    ]);
  });

  it("reports a not_job row from stage one stored as job mail", () => {
    const truth = expectedFile("tom").messages;
    const id = Object.keys(truth).find((k) => truth[k]?.stageOne === "not_job") as string;
    const stored = storedFromExpected("tom");
    Object.assign(find(stored, id), { category: "other_job", roles: [] });
    expect(compareWithExpected("tom", stored)).toEqual([
      { messageId: id, field: "category", expected: "not_job", stored: "other_job" },
    ]);
  });

  it("reports a role missing from a job alert", () => {
    const stored = storedFromExpected("maria");
    const alert = find(stored, MARIA_KEY_MESSAGES.multiRoleAlert);
    alert.roles = (alert.roles as JobFacts[]).slice(1);
    const diff = compareWithExpected("maria", stored);
    expect(diff.map((d) => [d.messageId, d.field])).toEqual([
      [MARIA_KEY_MESSAGES.multiRoleAlert, "roles"],
    ]);
  });

  it("reports job mail served without its roles", () => {
    const stored = storedFromExpected("maria");
    find(stored, MARIA_KEY_MESSAGES.germanRecruiter).roles = null;
    expect(compareWithExpected("maria", stored).map((d) => d.field)).toEqual(["roles"]);
  });

  it.each(PERSONAS)("reports altered pay on %s's mail", (persona) => {
    const stored = storedFromExpected(persona);
    const { s, role } = withRole(stored, (r) => r.pay?.min != null);
    (role.pay as NonNullable<JobFacts["pay"]>).min = (role.pay?.min as number) + 1;
    expect(compareWithExpected(persona, stored).map((d) => [d.messageId, d.field])).toEqual([
      [s.id, "roles"],
    ]);
  });

  it.each(PERSONAS)("reports an altered country on %s's mail", (persona) => {
    const stored = storedFromExpected(persona);
    const { s, role } = withRole(stored, (r) => r.places.some((p) => p.country !== null));
    const place = role.places.find((p) => p.country !== null) as JobFacts["places"][number];
    place.country = place.country === "ZZ" ? "ZY" : "ZZ";
    expect(compareWithExpected(persona, stored).map((d) => [d.messageId, d.field])).toEqual([
      [s.id, "roles"],
    ]);
  });

  it("reports a message the fake AI answers validly that ends Couldn't analyze", () => {
    const stored = storedFromExpected("maria");
    Object.assign(find(stored, MARIA_KEY_MESSAGES.offer), {
      category: null,
      analysisStatus: "failed",
      roles: null,
    });
    expect(compareWithExpected("maria", stored)).toEqual([
      {
        messageId: MARIA_KEY_MESSAGES.offer,
        field: "analysis",
        expected: "done",
        stored: "failed",
      },
    ]);
  });

  it("reports a message the app lists that expected.json does not know", () => {
    const stored = storedFromExpected("tom");
    stored.push({
      id: "<mangled@id.example>",
      category: "not_job",
      categorySource: "scan",
      analysisStatus: "done",
      roles: null,
    });
    expect(compareWithExpected("tom", stored)).toEqual([
      {
        messageId: "<mangled@id.example>",
        field: "message",
        expected: null,
        stored: "<mangled@id.example>",
      },
    ]);
  });

  it("compares delivered mail (MVP 2) with its ground truth, and never requires it", () => {
    const { deliveries } = readJson<ExpectedFileMvp2>(
      `${fixturesDir()}${personaPaths("maria").expected}`,
    );
    const [id, truth] = Object.entries(deliveries)[0] as [
      string,
      ExpectedFileMvp2["messages"][string],
    ];
    const delivered: StoredMessage = {
      id,
      category: truth.category,
      categorySource: "scan",
      analysisStatus: "done",
      roles: structuredClone(truth.facts ?? []),
    };
    const stored = [...storedFromExpected("maria"), delivered];
    expect(compareWithExpected("maria", stored, { complete: true })).toEqual([]);
    delivered.category = "job_alert";
    expect(compareWithExpected("maria", stored)).toEqual([
      { messageId: id, field: "category", expected: "recruiter_outreach", stored: "job_alert" },
    ]);
  });

  it("skips unanalysed messages unless every message must be analysed", () => {
    const stored = storedFromExpected("maria");
    const alert = find(stored, MARIA_KEY_MESSAGES.multiRoleAlert);
    Object.assign(alert, { analysisStatus: "pending", roles: [] });
    const recruiter = MARIA_KEY_MESSAGES.germanRecruiter;
    const rest = stored.filter((s) => s.id !== recruiter);
    expect(compareWithExpected("maria", rest)).toEqual([]);
    expect(compareWithExpected("maria", rest, { complete: true })).toEqual([
      { messageId: alert.id, field: "analysis", expected: "done", stored: "pending" },
      { messageId: recruiter, field: "message", expected: recruiter, stored: null },
    ]);
  });

  it("leaves a corrected category (F5.4) out but still compares its roles", () => {
    const stored = storedFromExpected("maria");
    Object.assign(find(stored, MARIA_KEY_MESSAGES.rejection), {
      category: "other_job",
      categorySource: "you",
    });
    expect(compareWithExpected("maria", stored)).toEqual([]);
    const recruiter = find(stored, MARIA_KEY_MESSAGES.germanRecruiter);
    Object.assign(recruiter, { categorySource: "you", roles: [] });
    expect(compareWithExpected("maria", stored).map((d) => [d.messageId, d.field])).toEqual([
      [recruiter.id, "roles"],
    ]);
  });
});

describe("collectStored", () => {
  /**
   * The messages API over `stored`, recording every path it is asked for. Its pages hold 25, not
   * the app's 100, so that every persona's list spans several pages.
   */
  function fakeApi(workspaceId: string, stored: StoredMessage[]) {
    const paths: string[] = [];
    const base = `/api/workspaces/${workspaceId}/messages`;
    const get: GetJson = async (path) => {
      paths.push(path);
      const url = new URL(path, "http://stack.example");
      if (url.pathname === base) {
        expect(url.searchParams.get("showNonJob")).toBe("true");
        const page = Number(url.searchParams.get("page"));
        const items = stored.slice((page - 1) * 25, page * 25).map(({ roles, ...item }) => item);
        return {
          items,
          nonJobCount: 0,
          page,
          nextPage: page * 25 < stored.length ? page + 1 : null,
        };
      }
      const id = decodeURIComponent(url.pathname.slice(base.length + 1));
      const s = stored.find((m) => m.id === id);
      if (s === undefined) throw new Error(`404 ${path}`);
      return { ...s, roles: s.roles ?? [], ownReply: false };
    };
    return { get, paths };
  }

  it.each(PERSONAS)("reads every page and the roles of %s's job mail", async (persona) => {
    const stored = storedFromExpected(persona);
    const workspaceId = "0b5f6c1e-6a4e-4a8e-9a43-3f1d2c7b9e10";
    const { get, paths } = fakeApi(workspaceId, stored);
    const collected = await collectStored(get, workspaceId);
    expect(collected).toEqual(stored);
    const pages = paths.filter((p) => p.includes("?"));
    expect(pages.length).toBe(Math.ceil(stored.length / 25));
    expect(pages.length).toBeGreaterThan(1);
    const jobMail = stored.filter((s) => s.category !== null && isJobCategory(s.category));
    expect(paths.length - pages.length).toBe(jobMail.length);
    expect(compareWithExpected(persona, collected, { complete: true })).toEqual([]);
  });

  it("reads and compares the roles of a job message a person corrected to not_job (F5.4)", async () => {
    const stored = storedFromExpected("maria");
    // The app keeps the roles its analysis found; a correction changes only the category.
    const corrected = find(stored, MARIA_KEY_MESSAGES.germanRecruiter);
    Object.assign(corrected, { category: "not_job", categorySource: "you" });
    const workspaceId = "0b5f6c1e-6a4e-4a8e-9a43-3f1d2c7b9e10";
    const { get, paths } = fakeApi(workspaceId, stored);
    const collected = await collectStored(get, workspaceId);
    expect(paths).toContain(
      `/api/workspaces/${workspaceId}/messages/${encodeURIComponent(corrected.id)}`,
    );
    expect(find(collected, corrected.id).roles?.length).toBeGreaterThan(0);
    expect(compareWithExpected("maria", collected, { complete: true })).toEqual([]);

    // Its roles are still compared: a role lost along with the correction is reported.
    const { get: lossy } = fakeApi(
      workspaceId,
      stored.map((s) => (s.id === corrected.id ? { ...s, roles: [] } : s)),
    );
    const diff = compareWithExpected("maria", await collectStored(lossy, workspaceId));
    expect(diff.map((d) => [d.messageId, d.field])).toEqual([[corrected.id, "roles"]]);
  });

  it("fails loudly on an answer that is no message list", async () => {
    await expect(collectStored(async () => ({ error: "forbidden" }), "w")).rejects.toThrow(
      "no items",
    );
  });
});
