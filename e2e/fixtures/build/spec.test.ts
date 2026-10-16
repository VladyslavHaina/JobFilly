import { describe, expect, it } from "vitest";
import type { JobFacts } from "../format.ts";
import { pay, role } from "./facts.ts";
import { maria } from "./maria.ts";
import {
  applyConflictTable,
  isAnalysed,
  MessageBook,
  type MessageSpec,
  roleWhere,
} from "./spec.ts";
import { tom } from "./tom.ts";

// The hard conflicts are ground truth written by hand (MessageSpec.hardConflicts, and for
// generated mail a table checked against each role's facts), so E2E measures the app's scorer,
// not a copy of it.

function message(book: MessageBook, facts: JobFacts[] | null, extra: Partial<MessageSpec> = {}) {
  return book.add({
    folder: "inbox",
    minutesAgo: 60,
    from: { address: "someone@example.example", name: null },
    to: [],
    subject: "A role",
    body: "",
    footer: [],
    stageOne: "likely_job",
    category: "recruiter_outreach",
    facts,
    preferences: null,
    invalid: false,
    ...extra,
  });
}

const MUNICH = role({
  places: [{ country: "DE", city: "Munich" }],
  workMode: "hybrid",
  pay: pay(75000, 90000, "EUR", "year", "€75,000–90,000 a year"),
});
const REMOTE = role({ workMode: "remote" });

describe("roleWhere", () => {
  it("names a role by its places, its work mode and the top of its pay", () => {
    expect(roleWhere(MUNICH)).toBe("Munich hybrid ≤90000 EUR/year");
    expect(roleWhere(REMOTE)).toBe("remote");
    expect(roleWhere(role({ places: [{ country: "PT", city: null }] }))).toBe("PT mode not stated");
  });
});

describe("applyConflictTable", () => {
  it("gives each role of an analysed message the conflicts its line writes", () => {
    const book = new MessageBook("maria");
    const m = message(book, [MUNICH, REMOTE]);
    applyConflictTable(book.messages, {
      "0001": ["Munich hybrid ≤90000 EUR/year: places", "remote: none"],
    });
    expect(m.hardConflicts).toEqual([["places"], []]);
  });

  it("leaves conflicts written at the role, and messages the app doesn't analyse, alone", () => {
    const book = new MessageBook("maria");
    const written = message(book, [MUNICH], { hardConflicts: [["places"]] });
    const notJob = message(book, null, { category: "not_job" });
    const invalid = message(book, [MUNICH], { invalid: true });
    applyConflictTable(book.messages, {});
    expect(written.hardConflicts).toEqual([["places"]]);
    expect(notJob.hardConflicts).toBeNull();
    expect(invalid.hardConflicts).toBeNull();
  });

  it("refuses a role that no longer reads as its line says, so stale ground truth can't stay", () => {
    const book = new MessageBook("maria");
    message(book, [MUNICH]);
    expect(() =>
      applyConflictTable(book.messages, { "0001": ["Berlin hybrid ≤90000 EUR/year: none"] }),
    ).toThrow(/is "Munich hybrid ≤90000 EUR\/year"/);
  });

  it("refuses a missing message, a wrong number of roles, a line it can't read and an unused line", () => {
    const book = new MessageBook("maria");
    message(book, [MUNICH]);
    expect(() => applyConflictTable(book.messages, {})).toThrow(/no hard conflicts written/);
    expect(() => applyConflictTable(book.messages, { "0001": [] })).toThrow(/1 roles, 0 written/);
    expect(() =>
      applyConflictTable(book.messages, { "0001": ["Munich hybrid ≤90000 EUR/year: maybe"] }),
    ).toThrow(/can't read/);
    expect(() =>
      applyConflictTable(book.messages, {
        "0001": ["Munich hybrid ≤90000 EUR/year: places"],
        "0002": ["remote: none"],
      }),
    ).toThrow(/written for no message: 0002/);
  });
});

describe("the persona sources", () => {
  it.each([
    ["maria", maria],
    ["tom", tom],
  ] as const)(
    "write hard conflicts for every role of %s's analysed mail, and nowhere else",
    (_, p) => {
      for (const m of p().messages) {
        if (isAnalysed(m)) {
          expect(m.hardConflicts?.length, m.messageId).toBe(m.facts?.length ?? 0);
        } else {
          expect(m.hardConflicts, m.messageId).toBeNull();
        }
      }
    },
  );
});
