import type { ProfileEntry } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { type DraftAnswer, draftEntries, findPlaceholders } from "./index";

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

  it("lets brackets copied from the original message through, and still catches slots", () => {
    const original = {
      subject: "[External] Backend Engineer",
      text: "Hi Maria,\n\n[LinkedIn] sent us your profile. Role ref {REF-2231}.\n\nBest, Anna",
    };
    // The subject and body of a reply to it keep the original's own brackets, in any case.
    const reply =
      "Re: [External] Backend Engineer\nHi Anna, thanks: the [linkedin] note reached me.";
    expect(findPlaceholders(reply, original)).toEqual([]);
    expect(findPlaceholders("Re: [ External ] Backend Engineer", original)).toEqual([]);
    // Slots the original doesn't hold are still placeholders.
    expect(
      findPlaceholders(
        `Re: [External] Backend Engineer\nDear [Name], I'd join [Company].`,
        original,
      ),
    ).toEqual(["[Name]", "[Company]"]);
    expect(findPlaceholders("Best, [Your name]", original)).toEqual(["[Your name]"]);
    // Without the original, every bracketed word is suspect.
    expect(findPlaceholders("Re: [External] Backend Engineer")).toEqual(["[External]"]);
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
    const asked = (profileKey: DraftAnswer["profileKey"], groupKey: string) => ({
      profileKey,
      groupKey,
      question: "?",
    });
    expect(
      draftEntries(entries, [{ ...asked("min_pay", "min_pay:CHF:year"), value: chf }]),
    ).toEqual([{ key: "min_pay", label: "min_pay", value: [eur, chf] }]);
    expect(
      draftEntries(entries, [{ ...asked("extra.relocate", "extra.relocate"), value: "Yes" }]),
    ).toEqual([
      { key: "min_pay", label: "min_pay", value: [eur] },
      { key: "extra.relocate", label: "relocate", value: ["Yes"] },
    ]);
    // The profile itself is untouched.
    expect(entries[0]?.value).toEqual([eur]);
  });

  it("gives a no as the question and its answer, adding no item to the key", () => {
    const entries = [entry("min_pay", [eur])];
    const declined = {
      profileKey: "places" as const,
      groupKey: "places:IE:Dublin:hybrid",
      question: "Hybrid in Dublin?",
      value: "No",
    };
    const ok = {
      profileKey: "min_pay" as const,
      groupKey: "min_pay:CHF:year",
      question: "?",
      value: chf,
    };
    expect(draftEntries(entries, [declined, ok])).toEqual([
      { key: "min_pay", label: "min_pay", value: [eur, chf] },
      { key: "extra.answer_places_ie_dublin_hybrid", label: "Hybrid in Dublin?", value: ["No"] },
    ]);
  });
});
