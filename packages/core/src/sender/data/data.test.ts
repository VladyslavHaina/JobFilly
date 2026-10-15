import { describe, expect, it } from "vitest";
import { loadFreeMailDomains, loadMessageSignals } from "../index";

// The sender check's data files parse against their schemas and hold what F5.5 needs: phrases
// for a fee and a passport scan in every language the fixtures write in.

describe("the sender data files", () => {
  it("list free-mail domains in lower case", () => {
    const { domains } = loadFreeMailDomains();
    expect(domains).toContain("gmail.com");
    for (const d of domains) expect(d).toBe(d.toLowerCase());
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("have phrases for every signal in English, German, Portuguese and Dutch, lower case", () => {
    const { languages } = loadMessageSignals();
    expect(Object.keys(languages).sort()).toEqual(["de", "en", "nl", "pt"]);
    for (const lists of Object.values(languages)) {
      for (const phrases of [lists.asks_for_fee, lists.asks_for_id, lists.chat_only]) {
        expect(phrases.length).toBeGreaterThan(0);
        for (const p of phrases) expect(p).toBe(p.toLowerCase());
      }
    }
    expect(languages.en?.asks_for_id).toContain("passport scan");
  });
});
