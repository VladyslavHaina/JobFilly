import type { SenderCheck } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { domainLookups } from "../tables";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { getSenderChecks, markStale, saveSenderCheck } from "./evaluations";
import { saveAnalysis, saveEnvelopes } from "./messages";
import {
  clearSenderMark,
  findMessageSenderMark,
  findSenderMark,
  getDomainLookup,
  lastLookupFailure,
  listWorkspacesWithFailedLookups,
  markFailedLookupChecksStale,
  saveDomainLookup,
  setSenderMark,
} from "./senders";

// Sender marks (F5.4), the domain lookup cache (TBD-165) and the stale flag a mark sets on the
// sender's checks, on PGlite.

let conn: DatabaseConnection;
let ws: string;
let other: string;
let userId: string;
const at = new Date("2026-10-01T10:00:00Z");

beforeEach(async () => {
  conn = await openTestDatabase();
  const made = [];
  for (const key of ["maria", "tom"]) {
    const r = await registerAccount(conn.db, {
      name: key,
      email: `${key}@inbox.example`,
      passwordHash: "h",
      workspaceName: key,
    });
    if (!r.ok) throw new Error("expected ok");
    made.push(r);
  }
  ws = made[0]?.workspaceId ?? "";
  other = made[1]?.workspaceId ?? "";
  userId = made[0]?.user.id ?? "";
});
afterEach(() => conn.close());

describe("sender marks (F5.4)", () => {
  it("marks an address, replaces the mark, and clears it", async () => {
    await setSenderMark(conn.db, ws, {
      scope: "address",
      value: "Globex.Talent@Gmail.com",
      mark: "trusted",
      userId,
      at,
    });
    expect(await findSenderMark(conn.db, ws, "globex.talent@gmail.com")).toEqual({
      mark: "trusted",
      scope: "address",
      value: "globex.talent@gmail.com",
    });
    await setSenderMark(conn.db, ws, {
      scope: "address",
      value: "globex.talent@gmail.com",
      mark: "blocked",
      userId,
      at,
    });
    expect((await findSenderMark(conn.db, ws, "GLOBEX.TALENT@gmail.com"))?.mark).toBe("blocked");
    expect(
      await clearSenderMark(conn.db, ws, { scope: "address", value: "globex.talent@gmail.com" }),
    ).toBe(true);
    expect(
      await clearSenderMark(conn.db, ws, { scope: "address", value: "globex.talent@gmail.com" }),
    ).toBe(false);
    expect(await findSenderMark(conn.db, ws, "globex.talent@gmail.com")).toBeNull();
  });

  it("applies a domain's mark to every address of it, an address's mark first", async () => {
    await setSenderMark(conn.db, ws, {
      scope: "domain",
      value: "tidewater.example",
      mark: "blocked",
      userId,
      at,
    });
    expect(await findSenderMark(conn.db, ws, "grace.lin@tidewater.example")).toEqual({
      mark: "blocked",
      scope: "domain",
      value: "tidewater.example",
    });
    await setSenderMark(conn.db, ws, {
      scope: "address",
      value: "grace.lin@tidewater.example",
      mark: "trusted",
      userId,
      at,
    });
    expect((await findSenderMark(conn.db, ws, "grace.lin@tidewater.example"))?.scope).toBe(
      "address",
    );
    expect((await findSenderMark(conn.db, ws, "someone@tidewater.example"))?.mark).toBe("blocked");
    expect(await findSenderMark(conn.db, ws, "someone@other.example")).toBeNull();
  });

  it("keeps each workspace's marks to itself", async () => {
    await setSenderMark(conn.db, ws, {
      scope: "domain",
      value: "tidewater.example",
      mark: "trusted",
      userId,
      at,
    });
    expect(await findSenderMark(conn.db, other, "grace.lin@tidewater.example")).toBeNull();
    expect(
      await clearSenderMark(conn.db, other, { scope: "domain", value: "tidewater.example" }),
    ).toBe(false);
  });
});

describe("the domain lookup cache", () => {
  it("returns a lookup until it expires, per workspace and kind", async () => {
    const later = new Date(at.getTime() + 60_000);
    await saveDomainLookup(conn.db, ws, {
      domain: "Tidewater.example",
      kind: "rdap",
      ok: true,
      result: { registeredAt: "2012-03-01T00:00:00Z" },
      at,
      expiresAt: later,
    });
    expect(
      await getDomainLookup(conn.db, ws, { domain: "tidewater.example", kind: "rdap", now: at }),
    ).toEqual({ ok: true, result: { registeredAt: "2012-03-01T00:00:00Z" } });
    expect(
      await getDomainLookup(conn.db, ws, { domain: "tidewater.example", kind: "mx", now: at }),
    ).toBeNull();
    expect(
      await getDomainLookup(conn.db, other, { domain: "tidewater.example", kind: "rdap", now: at }),
    ).toBeNull();
    expect(
      await getDomainLookup(conn.db, ws, { domain: "tidewater.example", kind: "rdap", now: later }),
    ).toBeNull();
  });

  it("replaces a failure with a later answer", async () => {
    const until = new Date(at.getTime() + 60_000);
    const lookup = { domain: "tidewater.example", kind: "mx" as const };
    await saveDomainLookup(conn.db, ws, { ...lookup, ok: false, at, expiresAt: until });
    expect(await getDomainLookup(conn.db, ws, { ...lookup, now: at })).toEqual({ ok: false });
    expect(await lastLookupFailure(conn.db, ws, lookup)).toEqual({ keptMs: 60_000 });
    await saveDomainLookup(conn.db, ws, {
      ...lookup,
      ok: true,
      result: ["mx.tidewater.example"],
      at,
      expiresAt: until,
    });
    expect(await getDomainLookup(conn.db, ws, { ...lookup, now: at })).toEqual({
      ok: true,
      result: ["mx.tidewater.example"],
    });
    expect(await lastLookupFailure(conn.db, ws, lookup)).toBeNull();
  });

  it("treats a stored answer that doesn't fit its kind as a miss, never as no mail servers", async () => {
    const until = new Date(at.getTime() + 60_000);
    for (const [kind, result] of [
      ["mx", { hosts: "mx.tidewater.example" }],
      ["rdap", { registeredAt: "last spring" }],
    ] as const) {
      await conn.db.insert(domainLookups).values({
        workspaceId: ws,
        domain: "tidewater.example",
        kind,
        ok: true,
        result: result as never,
        lookedUpAt: at,
        expiresAt: until,
      });
      expect(
        await getDomainLookup(conn.db, ws, { domain: "tidewater.example", kind, now: at }),
      ).toBeNull();
    }
  });
});

async function seedChecked(
  messageId: string,
  from: string,
  check: SenderCheck = { verdict: "caution", complete: true, reasons: [], mark: null },
) {
  await saveEnvelopes(conn.db, ws, [
    {
      envelope: {
        messageId,
        folder: "inbox",
        folderPath: "INBOX",
        uidValidity: 1,
        uid: Number(messageId.replace(/\D/g, "")) || 1,
        date: at.toISOString(),
        from: { address: from, name: null },
        to: [],
        cc: [],
        replyTo: [],
        inReplyTo: null,
        references: [],
        subject: "s",
        listId: null,
        listUnsubscribe: null,
        precedence: null,
        autoSubmitted: null,
        snippet: "",
      },
      verdict: "likely_job",
      reason: null,
    },
  ]);
  await saveAnalysis(conn.db, ws, {
    messageId,
    scanId: null,
    category: "recruiter_outreach",
    roles: [],
  });
  await saveSenderCheck(conn.db, ws, messageId, check, at);
}

describe("the mark on a message's sender", () => {
  it("tells the mark that applies to a message's sender, from its own workspace only", async () => {
    await seedChecked("<m1@x>", "Grace.Lin@Tidewater.example");
    expect(await findMessageSenderMark(conn.db, ws, "<m1@x>")).toEqual({ applied: null });
    await setSenderMark(conn.db, ws, {
      scope: "domain",
      value: "tidewater.example",
      mark: "blocked",
      userId,
      at,
    });
    expect(await findMessageSenderMark(conn.db, ws, "<m1@x>")).toEqual({
      applied: { mark: "blocked", scope: "domain", value: "tidewater.example" },
    });
    expect(await findMessageSenderMark(conn.db, ws, "<m2@x>")).toBeNull();
    expect(await findMessageSenderMark(conn.db, other, "<m1@x>")).toBeNull();
  });
});

describe("the stale flag a mark sets", () => {
  it("makes stale the checks of the marked address, or of every address of the domain", async () => {
    await seedChecked("<m1@x>", "Grace.Lin@Tidewater.example");
    await seedChecked("<m2@x>", "hr@tidewater.example");
    await seedChecked("<m3@x>", "someone@other.example");
    const stale = async () =>
      (await getSenderChecks(conn.db, ws, ["<m1@x>", "<m2@x>", "<m3@x>"]))
        .filter((c) => c.stale)
        .map((c) => c.messageId)
        .sort();

    await markStale(conn.db, ws, { senderAddress: "grace.lin@tidewater.example" }, at);
    expect(await stale()).toEqual(["<m1@x>"]);
    await markStale(conn.db, ws, { senderDomain: "tidewater.example" }, at);
    expect(await stale()).toEqual(["<m1@x>", "<m2@x>"]);
    const check: SenderCheck = {
      verdict: "looks_fine",
      complete: true,
      reasons: [],
      mark: "trusted",
    };
    await saveSenderCheck(conn.db, ws, "<m1@x>", check, at);
    expect(await stale()).toEqual(["<m2@x>"]);
  });

  it("takes an address's domain after its last '@', as packages/core does", async () => {
    await seedChecked("<m1@x>", '"grace@home"@Tidewater.example');
    const stale = async () => (await getSenderChecks(conn.db, ws, ["<m1@x>"]))[0]?.stale;
    await markStale(conn.db, ws, { senderDomain: "home" }, at);
    expect(await stale()).toBe(false);
    await markStale(conn.db, ws, { senderDomain: "tidewater.example" }, at);
    expect(await stale()).toBe(true);
  });
});

describe("checks whose lookup failed (F5.3)", () => {
  const failed: SenderCheck = {
    verdict: "caution",
    complete: false,
    reasons: [{ signal: "lookup_failed", reason: "Couldn't look up the domain" }],
    mark: null,
  };
  const minutes = (n: number) => new Date(at.getTime() + n * 60_000);
  const failure = (domain: string, expiresAt: Date) =>
    saveDomainLookup(conn.db, ws, { domain, kind: "rdap", ok: false, at, expiresAt });

  it("looks a domain up again once its failure has left the cache", async () => {
    await seedChecked("<m1@x>", "grace.lin@Tidewater.example", failed);
    await seedChecked("<m2@x>", "hr@other.example", failed);
    await seedChecked("<m3@x>", "hr@fine.example");
    await failure("tidewater.example", minutes(15));
    await failure("other.example", minutes(60));

    expect(await listWorkspacesWithFailedLookups(conn.db, minutes(10))).toEqual([]);
    expect(await markFailedLookupChecksStale(conn.db, ws, minutes(10))).toBe(0);

    expect(await listWorkspacesWithFailedLookups(conn.db, minutes(16))).toEqual([ws]);
    expect(await markFailedLookupChecksStale(conn.db, other, minutes(16))).toBe(0);
    expect(await markFailedLookupChecksStale(conn.db, ws, minutes(16))).toBe(1);
    const checks = await getSenderChecks(conn.db, ws, ["<m1@x>", "<m2@x>", "<m3@x>"]);
    expect(checks.filter((c) => c.stale).map((c) => c.messageId)).toEqual(["<m1@x>"]);
    // Stale now, so not marked again before it has been checked again.
    expect(await markFailedLookupChecksStale(conn.db, ws, minutes(16))).toBe(0);
    expect(await listWorkspacesWithFailedLookups(conn.db, minutes(61))).toEqual([ws]);
  });

  it("finds the failure of an address with two '@' under its last one's domain", async () => {
    await seedChecked("<m1@x>", '"grace@home"@tidewater.example', failed);
    await failure("tidewater.example", minutes(15));
    expect(await markFailedLookupChecksStale(conn.db, ws, minutes(10))).toBe(0);
    expect(await markFailedLookupChecksStale(conn.db, ws, minutes(16))).toBe(1);
  });
});
