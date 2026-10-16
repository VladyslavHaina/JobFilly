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
    ["Permanent, full-time", "permanent"],
    ["within the EU", "EU"],
    ["Weekly On-Call rotation", "on-call"],
    ["No relocation; permanent", "permanent"],
    ["Not remote. Senior role", "senior"],
    ["No sponsorship needed", "No sponsorship needed"],
    ["Non-permanent, 6 months", "non-permanent"],
  ])("says it in %j: %j", (haystack, needle) => {
    expect(saysPlainly(haystack, needle)).toBe(true);
  });

  it.each([
    // Part of a longer joined word.
    ["Non-permanent, 6 months", "permanent"],
    ["Non-EU", "EU"],
    ["Node.js", "Node"],
    ["Cryptography", "crypto"],
    // After a negation in its clause.
    ["Not permanent, 6 months", "permanent"],
    ["Non permanent", "permanent"],
    ["Not a senior role", "senior"],
    ["No UK work permit", "UK work permit"],
    ["Without visa sponsorship", "visa sponsorship"],
    // The needle's words must all be there, in order.
    ["US", "Needs sponsorship for US"],
    ["anything", ""],
  ])("doesn't say it in %j: %j", (haystack, needle) => {
    expect(saysPlainly(haystack, needle)).toBe(false);
  });
});
