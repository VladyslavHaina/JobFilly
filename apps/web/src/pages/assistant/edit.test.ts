import type { Change } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { buildChanges, parseOffset, rawFields } from "./edit";
import { impactWords } from "./queries";

// Editing a proposal card (F8.2): offsets typed the way people write them, values read back into
// Changes, and the impact in plain words (F8.5).

describe("UTC offsets", () => {
  it("reads what people type", () => {
    expect(parseOffset("UTC+4")).toBe("UTC+04:00");
    expect(parseOffset(" utc + 5:30 ")).toBe("UTC+05:30");
    expect(parseOffset("UTC−1")).toBe("UTC-01:00");
    expect(parseOffset("-0330")).toBe("UTC-03:30");
    expect(parseOffset("UTC")).toBe("UTC+00:00");
    expect(parseOffset("UTC+15")).toBeNull();
    expect(parseOffset("Asia")).toBeNull();
  });
});

describe("buildChanges", () => {
  const changes: Change[] = [
    {
      op: "add",
      target: "rule",
      rule: {
        description: "Hide Asian hours",
        when: [
          { fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } },
          { fact: "agency", op: "in", value: ["Acme Talent"] },
        ],
        then: "hide",
        enabled: true,
      },
    },
    { op: "update", target: "entry", key: "reply_threshold", value: [70] },
    { op: "add", target: "entry", key: "languages", value: ["German"] },
  ];

  it("gives back the same changes when nothing was typed", () => {
    expect(buildChanges(changes, rawFields(changes))).toEqual({ ok: true, changes });
  });

  it("reads the typed range, words and number", () => {
    const raw = {
      ...rawFields(changes),
      "0.when.0.from": "UTC+4",
      "0.when.1": "Acme Talent, Zeta Search",
      "1.value": "80",
      "2.value": "German, Dutch",
    };
    const built = buildChanges(changes, raw);
    if (!built.ok) throw new Error(built.error);
    expect(built.changes[0]).toMatchObject({
      rule: {
        when: [
          { value: { from: "UTC+04:00", to: "UTC+14:00" } },
          { value: ["Acme Talent", "Zeta Search"] },
        ],
      },
    });
    expect(built.changes[1]).toMatchObject({ value: [80] });
    expect(built.changes[2]).toMatchObject({ value: ["German", "Dutch"] });
  });

  it("says what is wrong with a value", () => {
    expect(buildChanges(changes, { ...rawFields(changes), "0.when.0.to": "later" })).toEqual({
      ok: false,
      error: "Write each offset like UTC+4 or UTC−1:30.",
    });
    expect(buildChanges(changes, { ...rawFields(changes), "1.value": "a lot" })).toEqual({
      ok: false,
      error: "Give a whole number.",
    });
  });
});

describe("impactWords", () => {
  it("words the impact on the current roles", () => {
    const none = { hides: 0, shows: 0, scoreMoves: 0, draftsNotCreated: 0, draftsInMailbox: 0 };
    expect(impactWords({ ...none, hides: 3, draftsInMailbox: 1 })).toBe(
      "hides 3 roles; 1 draft is already in your mailbox and stays there",
    );
    expect(impactWords({ ...none, shows: 1, scoreMoves: 2, draftsNotCreated: 2 })).toBe(
      "shows 1 role again; changes the fit score of 2 roles; 2 drafts won't be created",
    );
    expect(impactWords({ ...none, draftsInMailbox: 2 })).toBe(
      "changes none of your current roles; 2 drafts are already in your mailbox and stay there",
    );
  });
});
