import type { SenderCheck } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../client";
import { openTestDatabase } from "../testing";
import { registerAccount } from "./accounts";
import { getSenderChecks, markStale, saveSenderCheck } from "./evaluations";
import { saveAnalysis, saveEnvelopes } from "./messages";
import {
  clearSenderMark,
  findSenderMark,
  getDomainLookup,
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
    await saveDomainLookup(conn.db, ws, {
      ...lookup,
      ok: false,
      result: null,
      at,
      expiresAt: until,
    });
    expect(await getDomainLookup(conn.db, ws, { ...lookup, now: at })).toEqual({
      ok: false,
      result: null,
    });
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
  });
});

describe("the stale flag a mark sets", () => {
  async function seedChecked(messageId: string, from: string) {
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
    const check: SenderCheck = { verdict: "caution", complete: true, reasons: [], mark: null };
    await saveSenderCheck(conn.db, ws, messageId, check, at);
  }

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
});
