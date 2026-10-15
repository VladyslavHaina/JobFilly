import type { ProfileEntry } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { draftEntries, findPlaceholders } from "./index";

const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "you",
  updatedAt: "2026-10-01T10:00:00.000Z",
  updatedBy: null,
});

describe("the placeholder check (F6.2)", () => {
  it("rejects '[Name]' and '{company}'", () => {
    expect(findPlaceholders("Dear [Name],\nthanks for the role.")).toEqual(["[Name]"]);
    expect(findPlaceholders("I'd love to join {company}.")).toEqual(["{company}"]);
    expect(findPlaceholders("Hi {{first_name}}, [Your Name] here")).toEqual([
      "{{first_name}}",
      "[Your Name]",
    ]);
  });

  it("lets ordinary text through", () => {
    expect(findPlaceholders("Hallo Herr Weber,\n\nvielen Dank (Berlin, hybrid).")).toEqual([]);
    expect(findPlaceholders("Pay [1] and {} and [ ] stay")).toEqual([]);
  });
});

describe("what a draft may use (F6.2)", () => {
  const eur = { amount: 70000, currency: "EUR", period: "year" as const, asWritten: "70k EUR" };
  const chf = { amount: 120000, currency: "CHF", period: "year" as const, asWritten: "120k CHF" };

  it("is the profile's entries", () => {
    expect(draftEntries([entry("min_pay", [eur])])).toEqual([
      { key: "min_pay", label: "min_pay", value: [eur] },
    ]);
  });

  it("adds an answer given for this role only, keeping the profile's items", () => {
    const entries = [entry("min_pay", [eur])];
    expect(draftEntries(entries, [{ profileKey: "min_pay", value: chf }])).toEqual([
      { key: "min_pay", label: "min_pay", value: [eur, chf] },
    ]);
    expect(draftEntries(entries, [{ profileKey: "extra.relocate", value: "Yes" }])).toEqual([
      { key: "min_pay", label: "min_pay", value: [eur] },
      { key: "extra.relocate", label: "relocate", value: ["Yes"] },
    ]);
    // The profile itself is untouched.
    expect(entries[0]?.value).toEqual([eur]);
  });
});
