import { describe, expect, it } from "vitest";
import { mentions, saysPlainly } from "./words";

// The one whole-word matcher of the rules engine and the match (F3, F4.1, F4.2): `mentions` for
// deal-breakers and a rule's "mentions", `saysPlainly` where a fit is claimed.

describe("mentions", () => {
  it.each([
    ["Crypto Exchange GmbH", "crypto"],
    ["Crypto-Exchange GmbH", "crypto"],
    ["Java-based microservices", "Java"],
    ["Defense-Tech AG", "defense"],
    ["the gambling's industry", "gambling"],
    ["Node.js", "Node"],
    ["Weekly On-Call rotation", "on call"],
    ["Weekly On-Call rotation", "on-call"],
    ["Java/Kotlin", "Java"],
    ["C++ and Rust", "C++"],
  ])("finds it in %j: %j", (haystack, needle) => {
    expect(mentions(haystack, needle)).toBe(true);
  });

  it.each([
    ["Cryptography Solutions", "crypto"],
    ["JavaScript", "Java"],
    ["Objective-C", "C++"],
    ["Oncall-free team", "on call"],
    ["anything", ""],
    ["anything", " - "],
  ])("doesn't find it in %j: %j", (haystack, needle) => {
    expect(mentions(haystack, needle)).toBe(false);
  });
});

describe("saysPlainly", () => {
  it.each([
    // The same wording once normalised.
    ["Permanent", "permanent"],
    ["  Senior   engineer ", "senior engineer"],
    ["No sponsorship needed", "No sponsorship needed"],
    ["Weekly On-Call rotation", "weekly on call rotation"],
    ["Festanstellung", "Festanstellung"],
    // One clause is exactly the phrase.
    ["Permanent, full-time", "permanent"],
    ["Full-time; permanent", "permanent"],
    ["No relocation; permanent", "permanent"],
    ["Not remote. Senior", "senior"],
    ["Non-permanent, 6 months", "non-permanent"],
    ["EU\nUS", "EU"],
    ["Senior / Lead", "lead"],
  ])("says it in %j: %j", (haystack, needle) => {
    expect(saysPlainly(haystack, needle)).toBe(true);
  });

  // No negation words are kept, in any language: anything more than the phrase in its clause is
  // unknown, whether it negates the phrase or not (F4.1).
  it.each([
    // Negated, in English.
    ["Not permanent, 6 months", "permanent"],
    ["Non-permanent, 6 months", "permanent"],
    ["Non permanent", "permanent"],
    ["This isn't a permanent role", "permanent"],
    ["Permanent: no", "permanent"],
    ["Permanent — no", "permanent"],
    ["Permanent? No", "permanent"],
    ["Not a senior role", "senior"],
    ["Non-EU", "EU"],
    ["No UK work permit", "UK work permit"],
    ["Without visa sponsorship", "visa sponsorship"],
    // Negated, in another language.
    ["Keine Festanstellung", "Festanstellung"],
    ["Pas de CDI", "CDI"],
    // Not negated, but more than the phrase: not plain enough to claim a fit.
    ["within the EU", "EU"],
    ["Weekly On-Call rotation", "on-call"],
    ["Not remote. Senior role", "senior"],
    ["Node.js", "Node"],
    ["Cryptography", "crypto"],
    // The needle's words must all be there, in order.
    ["US", "Needs sponsorship for US"],
    ["anything", ""],
  ])("doesn't say it in %j: %j", (haystack, needle) => {
    expect(saysPlainly(haystack, needle)).toBe(false);
  });
});
