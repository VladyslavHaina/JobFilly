import type {
  JobFacts,
  MatchAiOutput,
  MatchVerdict,
  ProfileEntry,
  ProfileKey,
  ProfileValue,
  Rule,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { type MatchRoleInput, matchRole, matchTaskInput, needsMatchAi } from "./match";

// The explainable match (F4.1–F4.4): a verdict with a reason for every entry and rule that
// applies, hard conflicts capping the score at 40 and listed first, pay only in the same currency
// and period (with the need a reply can't go without), skills from the chosen CV and the profile,
// and a score that is a pure function of its input.

const entry = (key: ProfileKey, value: ProfileValue): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "you",
  updatedAt: "2026-10-15T12:00:00.000Z",
  updatedBy: null,
});

/** Maria's profile, as she confirmed it in MVP 1 (Amsterdam already removed). */
const maria = {
  entries: [
    entry("target_roles", ["Backend Engineer", "Backend Developer"]),
    entry("seniority", ["Senior"]),
    entry("places", [{ country: "DE", city: "Berlin", mode: "hybrid" }]),
    entry("remote", [{ scope: "EU", timeZones: null }]),
    entry("contracts", ["permanent", "B2B"]),
    entry("min_pay", [
      { amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" },
      { amount: 450, currency: "EUR", period: "day", asWritten: "€450 a day" },
    ]),
    entry("languages", ["English", "Portuguese"]),
    entry("deal_breakers", ["on-call"]),
  ],
};

const facts = (overrides: Partial<JobFacts> = {}): JobFacts => ({
  title: "Senior Backend Engineer",
  company: "Nordlicht Payments",
  agency: null,
  places: [{ country: "DE", city: "Berlin" }],
  workMode: "hybrid",
  remoteScope: null,
  timeZones: null,
  pay: { min: 80000, max: 95000, currency: "EUR", period: "year", asWritten: "€80–95k a year" },
  contract: "Permanent",
  seniority: "Senior",
  workPermit: null,
  skills: ["Go", "PostgreSQL", "Kafka"],
  languages: ["English"],
  applyUrl: null,
  extra: {},
  ...overrides,
});

const titleFits: MatchAiOutput = {
  titleFit: { verdict: "fits", reason: "a backend engineer role" },
  skillCloseness: [
    { skill: "Go", verdict: "fits", reason: "in the CV" },
    { skill: "PostgreSQL", verdict: "fits", reason: "in the CV" },
    { skill: "Kafka", verdict: "fits", reason: "close to RabbitMQ" },
  ],
};

const CV = "00000000-0000-4000-8000-0000000000c1";

const input = (overrides: Partial<MatchRoleInput> = {}): MatchRoleInput => ({
  facts: facts(),
  senderAddress: "anna@nordlicht.example",
  category: "recruiter_outreach",
  profile: maria,
  rules: [],
  cv: { cvId: CV, skills: ["Go", "PostgreSQL", "Kubernetes", "RabbitMQ"] },
  ai: titleFits,
  ...overrides,
});

const byKey = (verdicts: MatchVerdict[], key: ProfileKey) =>
  verdicts.find((v) => v.entryKey === key);

describe("matchRole (F4.1)", () => {
  it("gives every entry that applies a verdict with a reason, and a score from 0 to 100", () => {
    const { match } = matchRole(input());
    expect(match.capped).toBe(false);
    expect(match.score).toBeGreaterThanOrEqual(70);
    expect(match.score).toBeLessThanOrEqual(100);
    expect(match.cvId).toBe(CV);
    expect(match.verdicts.map((v) => [v.entryKey, v.verdict, v.reason])).toEqual([
      ["target_roles", "fits", '"Senior Backend Engineer" — a backend engineer role'],
      [
        "extra.skills",
        "fits",
        "2 of 3 skills in your CV or profile; matched: Go, PostgreSQL; missing: Kafka. Close to your skills, but not listed in your CV or profile: Kafka",
      ],
      ["places", "fits", "Berlin, hybrid — fits your 'Berlin, hybrid'"],
      ["min_pay", "fits", "€80–95k a year — meets your minimum of €70,000 a year"],
      ["contracts", "fits", "\"Permanent\" — fits your 'permanent'"],
      ["languages", "fits", "English — among your working languages"],
      ["seniority", "fits", "\"Senior\" — fits your 'Senior'"],
      ["deal_breakers", "fits", "None of your deal-breakers is mentioned in the role"],
    ]);
    expect(match.verdicts.every((v) => v.reason.length > 0 && !v.hard && v.need === null)).toBe(
      true,
    );
  });

  it("says unknown, with why, for what the mail doesn't state", () => {
    const { match } = matchRole(
      input({
        facts: facts({ title: null, places: [], pay: null, contract: null, skills: [] }),
        ai: null,
      }),
    );
    expect(match.verdicts.map((v) => [v.entryKey, v.verdict, v.reason])).toEqual([
      ["target_roles", "unknown", "title not stated"],
      ["extra.skills", "unknown", "skills not stated"],
      ["places", "unknown", "Hybrid — place not stated"],
      ["min_pay", "unknown", "pay not stated"],
      ["contracts", "unknown", "contract not stated"],
      ["languages", "fits", "English — among your working languages"],
      ["seniority", "fits", "\"Senior\" — fits your 'Senior'"],
      ["deal_breakers", "fits", "None of your deal-breakers is mentioned in the role"],
    ]);
    // A reply can go without these: none of them asks a question.
    expect(match.verdicts.every((v) => v.need === null)).toBe(true);
  });

  it("reads remote work against the remote entry and its hours", () => {
    const remote = (timeZones: JobFacts["timeZones"], mine = maria) =>
      byKey(
        matchRole(input({ facts: facts({ workMode: "remote", timeZones }), profile: mine })).match
          .verdicts,
        "remote",
      );
    expect(remote(null)).toMatchObject({
      verdict: "fits",
      reason: "Remote — fits your remote 'EU'",
    });
    const withHours = {
      entries: [
        ...maria.entries.filter((e) => e.key !== "remote"),
        entry("remote", [{ scope: "EU", timeZones: { from: "UTC-01:00", to: "UTC+03:00" } }]),
      ],
    };
    expect(remote({ from: "UTC+01:00", to: "UTC+01:00" }, withHours)).toMatchObject({
      verdict: "fits",
      reason: "Remote, UTC+1 — fits your remote 'EU' (UTC−1 to UTC+3)",
    });
    expect(remote({ from: "UTC+08:00", to: "UTC+10:00" }, withHours)).toMatchObject({
      verdict: "conflicts",
      hard: false,
      reason: "Remote, UTC+8 to UTC+10 — outside your remote hours (UTC−1 to UTC+3)",
    });
    expect(remote({ from: "UTC+02:00", to: "UTC+05:00" }, withHours)?.verdict).toBe("unknown");
  });

  it("says a remote role fits only when the scope and places it states are yours", () => {
    const remote = (overrides: Partial<JobFacts>, mine = maria) => {
      const { match } = matchRole(
        input({ facts: facts({ workMode: "remote", places: [], ...overrides }), profile: mine }),
      );
      return { match, verdict: byKey(match.verdicts, "remote") };
    };
    const good = matchRole(input()).match.score;

    expect(remote({ remoteScope: "EU" }).verdict).toMatchObject({
      verdict: "fits",
      reason: "Remote, EU — fits your remote 'EU'",
    });
    expect(remote({ remoteScope: "UK, EU" }).verdict?.verdict).toBe("fits");
    // A clause after yours may take it back ("EU, no"), so it is asked.
    expect(remote({ remoteScope: "EU, UK" }).verdict?.verdict).toBe("unknown");
    // Neither a scope nor a place: where you may work from isn't stated, so it isn't a fit,
    // just as "from anywhere" isn't, nor a conflict, and it asks nothing.
    const unstated = remote({});
    expect(unstated.verdict).toMatchObject({
      verdict: "unknown",
      hard: false,
      need: null,
      reason: "Remote — where not stated, not compared with your remote 'EU'",
    });
    expect(unstated.match.capped).toBe(false);
    expect(unstated.match.score).toBe(remote({ remoteScope: "from anywhere" }).match.score);
    expect(unstated.match.score).toBeLessThan(remote({ remoteScope: "EU" }).match.score);
    const hoursOnly = {
      entries: [
        ...maria.entries.filter((e) => e.key !== "remote"),
        entry("remote", [{ scope: "EU", timeZones: { from: "UTC-01:00", to: "UTC+03:00" } }]),
      ],
    };
    expect(
      remote({ timeZones: { from: "UTC+01:00", to: "UTC+01:00" } }, hoursOnly).verdict,
    ).toMatchObject({
      verdict: "unknown",
      reason: "Remote, UTC+1 — where not stated, not compared with your remote 'EU'",
    });

    // Another scope: not compared, so neither a fit nor a conflict, and never capped.
    const us = remote({ remoteScope: "US only", places: [{ country: "US", city: null }] });
    expect(us.verdict).toMatchObject({
      verdict: "unknown",
      hard: false,
      reason: "Remote, US only, US — not compared with your remote 'EU'",
    });
    expect(us.match.capped).toBe(false);
    expect(us.match.score).toBeLessThan(good);
    // A scope with more words than yours is never read for what they mean: "Non-EU", "not the
    // EU", "within the EU" and "außerhalb der EU" alike are unknown, so a negation in any
    // language never fits.
    for (const remoteScope of [
      "Non-EU",
      "Non EU",
      "not the EU",
      "within the EU",
      "außerhalb der EU",
    ]) {
      expect(remote({ remoteScope }).verdict).toMatchObject({
        verdict: "unknown",
        hard: false,
        reason: `Remote, ${remoteScope} — not compared with your remote 'EU'`,
      });
    }
    expect(remote({ remoteScope: "from anywhere" }).verdict).toMatchObject({
      verdict: "unknown",
      reason: "Remote, from anywhere — not compared with your remote 'EU'",
    });

    // A foreign place with no scope.
    expect(remote({ places: [{ country: "SG", city: "Singapore" }] }).verdict).toMatchObject({
      verdict: "unknown",
      reason: "Remote, Singapore — not compared with your remote 'EU'",
    });
    // A place you accept, or one your remote scope names, is yours.
    expect(remote({ places: [{ country: "DE", city: "Berlin" }] }).verdict?.verdict).toBe("fits");
    const lisbon = {
      entries: [
        ...maria.entries.filter((e) => e.key !== "remote"),
        entry("remote", [{ scope: "PT, Lisbon", timeZones: null }]),
      ],
    };
    expect(remote({ places: [{ country: null, city: "Lisbon" }] }, lisbon).verdict?.verdict).toBe(
      "fits",
    );
    // Only the last clause of your scope names a place: a clause after "PT" may take it back.
    expect(remote({ places: [{ country: "PT", city: null }] }, lisbon).verdict?.verdict).toBe(
      "unknown",
    );
    // A remote scope only names a place in a clause of its own: "anywhere but PT" doesn't.
    const notPortugal = {
      entries: [
        ...maria.entries.filter((e) => e.key !== "remote"),
        entry("remote", [{ scope: "anywhere but PT", timeZones: null }]),
      ],
    };
    expect(remote({ places: [{ country: "PT", city: null }] }, notPortugal).verdict?.verdict).toBe(
      "unknown",
    );

    // Hours outside yours still conflict, whatever the scope.
    const withHours = {
      entries: [
        ...maria.entries.filter((e) => e.key !== "remote"),
        entry("remote", [{ scope: "EU", timeZones: { from: "UTC-01:00", to: "UTC+03:00" } }]),
      ],
    };
    expect(
      remote(
        { remoteScope: "US only", timeZones: { from: "UTC-08:00", to: "UTC-05:00" } },
        withHours,
      ).verdict?.verdict,
    ).toBe("conflicts");
    expect(
      remote(
        { remoteScope: "US only", timeZones: { from: "UTC+01:00", to: "UTC+01:00" } },
        withHours,
      ).verdict,
    ).toMatchObject({
      verdict: "unknown",
      reason: "Remote, US only — not compared with your remote 'EU'",
    });
  });

  it("fits a contract, seniority or work permit only when worded with the same whole words", () => {
    const contract = (stated: string) =>
      byKey(matchRole(input({ facts: facts({ contract: stated }) })).match.verdicts, "contracts");
    expect(contract("Permanent")).toMatchObject({
      verdict: "fits",
      reason: "\"Permanent\" — fits your 'permanent'",
    });
    expect(contract("Full-time, permanent")?.verdict).toBe("fits");
    // A clause after yours may qualify or take it back, so it is asked.
    expect(contract("Permanent, full-time")?.verdict).toBe("unknown");
    expect(contract("Non-permanent, 6 months")).toMatchObject({
      verdict: "unknown",
      reason: "\"Non-permanent, 6 months\" — not worded like your contracts ('permanent', 'B2B')",
    });
    expect(contract("Impermanent")?.verdict).toBe("unknown");
    expect(contract("B2Bish")?.verdict).toBe("unknown");

    const seniority = (stated: string) =>
      byKey(matchRole(input({ facts: facts({ seniority: stated }) })).match.verdicts, "seniority");
    expect(seniority("Lead, senior")?.verdict).toBe("fits");
    // A slash doesn't end a clause: "Senior / Lead" is more than your 'Senior'.
    expect(seniority("Senior / Lead")?.verdict).toBe("unknown");
    expect(seniority("Non-senior")).toMatchObject({
      verdict: "unknown",
      reason: "\"Non-senior\" — not worded like your 'Senior'",
    });
    expect(seniority("Seniority not important")?.verdict).toBe("unknown");

    const permits = {
      entries: [...maria.entries, entry("work_permits", [{ country: "DE", text: "EU citizen" }])],
    };
    const permit = (asked: string) =>
      byKey(
        matchRole(input({ profile: permits, facts: facts({ workPermit: asked }) })).match.verdicts,
        "work_permits",
      );
    expect(permit("Work permit; EU citizen")).toMatchObject({
      verdict: "fits",
      reason: "\"Work permit; EU citizen\" — fits your 'EU citizen'",
    });
    // A clause after yours, or more words in its clause than yours: not read for what they mean,
    // so unknown.
    expect(permit("EU citizen; or a work permit")?.verdict).toBe("unknown");
    expect(permit("EU citizen or work permit")?.verdict).toBe("unknown");
    expect(permit("Non-EU citizen")?.verdict).toBe("unknown");
    expect(permit("EU citizenship")?.verdict).toBe("unknown");
  });

  it("never fits a contract, seniority or work permit the wording negates", () => {
    const contract = (stated: string) =>
      byKey(matchRole(input({ facts: facts({ contract: stated }) })).match.verdicts, "contracts");
    expect(contract("Not permanent, 6 months")).toMatchObject({
      verdict: "unknown",
      reason: "\"Not permanent, 6 months\" — not worded like your contracts ('permanent', 'B2B')",
    });
    expect(contract("Non permanent")?.verdict).toBe("unknown");
    expect(contract("Without a permanent contract")?.verdict).toBe("unknown");
    expect(contract("No B2B")?.verdict).toBe("unknown");
    // No negation words are kept: a contraction, a "no" after a colon and another language all
    // come out unknown, and so are asked (F4.1).
    expect(contract("This isn't a permanent role")).toMatchObject({
      verdict: "unknown",
      reason:
        "\"This isn't a permanent role\" — not worded like your contracts ('permanent', 'B2B')",
    });
    expect(contract("Permanent: no")?.verdict).toBe("unknown");
    // Nor is a clause after the phrase: a "no" there takes it back.
    expect(contract("Permanent, no")).toMatchObject({
      verdict: "unknown",
      reason: "\"Permanent, no\" — not worded like your contracts ('permanent', 'B2B')",
    });
    expect(contract("Permanent. Not offered.")?.verdict).toBe("unknown");
    const german = {
      entries: [
        ...maria.entries.filter((e) => e.key !== "contracts"),
        entry("contracts", ["Festanstellung"]),
      ],
    };
    const germanContract = (stated: string) =>
      byKey(
        matchRole(input({ profile: german, facts: facts({ contract: stated }) })).match.verdicts,
        "contracts",
      );
    expect(germanContract("Keine Festanstellung")).toMatchObject({
      verdict: "unknown",
      reason: "\"Keine Festanstellung\" — not worded like your contracts ('Festanstellung')",
    });
    expect(germanContract("Festanstellung, nein")?.verdict).toBe("unknown");
    expect(germanContract("Festanstellung, Vollzeit")?.verdict).toBe("unknown");
    expect(germanContract("Vollzeit, Festanstellung")?.verdict).toBe("fits");
    // A negation in another clause says nothing about this one.
    expect(contract("No relocation; permanent")?.verdict).toBe("fits");

    const seniority = (stated: string) =>
      byKey(matchRole(input({ facts: facts({ seniority: stated }) })).match.verdicts, "seniority");
    expect(seniority("Not senior")).toMatchObject({
      verdict: "unknown",
      reason: "\"Not senior\" — not worded like your 'Senior'",
    });

    const withPermits = (permits: { country: string | null; text: string }[]) => ({
      entries: [...maria.entries, entry("work_permits", permits)],
    });
    const permit = (mine: { country: string | null; text: string }[], asked: string) =>
      byKey(
        matchRole(input({ profile: withPermits(mine), facts: facts({ workPermit: asked }) })).match
          .verdicts,
        "work_permits",
      );
    // Your permit's words are never read for the role's: 'No UK work permit' doesn't hold one.
    expect(permit([{ country: "GB", text: "No UK work permit" }], "UK work permit")).toMatchObject({
      verdict: "unknown",
      reason:
        "Asks for \"UK work permit\" — check it against your work permits ('No UK work permit')",
    });
    expect(permit([{ country: "US", text: "Needs sponsorship for US" }], "US")?.verdict).toBe(
      "unknown",
    );
    expect(permit([{ country: "GB", text: "UK work permit" }], "No UK work permit")?.verdict).toBe(
      "unknown",
    );
    expect(permit([{ country: "GB", text: "UK work permit" }], "UK work permit")?.verdict).toBe(
      "fits",
    );
  });

  it("is a pure function of facts, profile, rules, the CV choice and the match.v1 answer", () => {
    const one = input();
    expect(matchRole(one)).toEqual(matchRole(JSON.parse(JSON.stringify(one))));
    const worse = matchRole(
      input({ ai: { ...titleFits, titleFit: { verdict: "conflicts", reason: "data role" } } }),
    );
    expect(worse.match.score).toBeLessThan(matchRole(one).match.score);
    const fewerSkills = matchRole(input({ cv: { cvId: CV, skills: ["Go"] } }));
    expect(fewerSkills.match.score).toBeLessThan(matchRole(one).match.score);
  });
});

const cases: [string, Partial<MatchRoleInput>, ProfileKey | "rule", string][] = [
  [
    "a place not accepted",
    { facts: facts({ places: [{ country: "NL", city: "Amsterdam" }] }) },
    "places",
    "Amsterdam, hybrid — not one of your places ('Berlin, hybrid')",
  ],
  [
    "a work mode not accepted",
    { facts: facts({ places: [{ country: "SG", city: "Singapore" }], workMode: "onsite" }) },
    "places",
    "Singapore, onsite — not one of your places ('Berlin, hybrid')",
  ],
  [
    "onsite where you accept only hybrid",
    { facts: facts({ workMode: "onsite" }) },
    "places",
    "Berlin, onsite — you accept 'Berlin, hybrid' only",
  ],
  [
    "onsite with no place named, where you accept only hybrid",
    { facts: facts({ places: [], workMode: "onsite" }) },
    "places",
    "Onsite — you accept only hybrid ('Berlin, hybrid')",
  ],
  [
    "pay below the minimum in the same currency and period",
    {
      facts: facts({
        pay: { min: 50000, max: 60000, currency: "EUR", period: "year", asWritten: "€50–60k" },
      }),
    },
    "min_pay",
    "€50–60k — below your minimum of €70,000 a year",
  ],
  [
    "a deal-breaker",
    { facts: facts({ extra: { duties: "Weekly On-Call rotation" } }) },
    "deal_breakers",
    "Mentions 'on-call', one of your deal-breakers",
  ],
];

const RULE_ID = "00000000-0000-4000-8000-0000000000e1";
const capRule: Rule = {
  id: RULE_ID,
  profileId: "00000000-0000-4000-8000-0000000000ff",
  description: "Agencies score lower",
  when: [{ fact: "sender.domain", op: "in", value: ["nordlicht.example"] }],
  then: "cap_score",
  enabled: true,
  source: "assistant",
  createdAt: "2026-10-15T12:00:00.000Z",
  createdBy: null,
};

describe("hard conflicts (F4.2)", () => {
  it.each(cases)("%s caps the score at 40 and is listed first", (_name, overrides, key, reason) => {
    const good = matchRole(input()).match;
    const { match } = matchRole(input(overrides));
    expect(good.score).toBeGreaterThan(40);
    expect(match.score).toBeLessThanOrEqual(40);
    expect(match.capped).toBe(true);
    expect(match.verdicts[0]).toMatchObject({ entryKey: key, verdict: "conflicts", hard: true });
    expect(match.verdicts[0]?.reason).toBe(reason);
    expect(match.verdicts.filter((v) => v.hard)).toHaveLength(1);
  });

  it("a work mode one of your places takes, with no place named, stays unknown and uncapped", () => {
    const { match } = matchRole(input({ facts: facts({ places: [], workMode: "hybrid" }) }));
    expect(match.capped).toBe(false);
    expect(byKey(match.verdicts, "places")).toMatchObject({
      verdict: "unknown",
      hard: false,
      reason: "Hybrid — place not stated",
    });
    const onsite = {
      entries: [
        ...maria.entries.filter((e) => e.key !== "places"),
        entry("places", [{ country: "DE", city: "Munich", mode: "onsite" }]),
      ],
    };
    const both = matchRole(
      input({ profile: onsite, facts: facts({ places: [], workMode: "onsite" }) }),
    ).match;
    expect(both.capped).toBe(false);
    expect(byKey(both.verdicts, "places")).toMatchObject({
      verdict: "unknown",
      reason: "Onsite — place not stated",
    });
  });

  it("a place the mail only half-states is unknown, not a conflict", () => {
    const place = (
      rolePlaces: JobFacts["places"],
      mine = maria,
      workMode: JobFacts["workMode"] = "hybrid",
    ) => matchRole(input({ profile: mine, facts: facts({ places: rolePlaces, workMode }) })).match;

    // A country with no city, against your city.
    const country = place([{ country: "DE", city: null }]);
    expect(country.capped).toBe(false);
    expect(country.score).toBeGreaterThan(40);
    expect(byKey(country.verdicts, "places")).toMatchObject({
      verdict: "unknown",
      hard: false,
      reason: "DE, hybrid — city not stated, so not compared with your 'Berlin, hybrid'",
    });

    // A city with no country, against your country.
    const germany = {
      entries: [
        ...maria.entries.filter((e) => e.key !== "places"),
        entry("places", [{ country: "DE", city: null, mode: "hybrid" }]),
      ],
    };
    const city = place([{ country: null, city: "Berlin" }], germany);
    expect(city.capped).toBe(false);
    expect(city.score).toBeGreaterThan(40);
    expect(byKey(city.verdicts, "places")).toMatchObject({
      verdict: "unknown",
      hard: false,
      reason: "Berlin, hybrid — country not stated, so not compared with your 'DE, hybrid'",
    });

    // Stated in full, they compare as before.
    expect(
      byKey(place([{ country: "DE", city: "Berlin" }], germany).verdicts, "places")?.verdict,
    ).toBe("fits");
    expect(byKey(place([{ country: null, city: "Berlin" }]).verdicts, "places")?.verdict).toBe(
      "fits",
    );
    // Another country, or another city, is still not one of your places.
    expect(place([{ country: "NL", city: null }]).capped).toBe(true);
    expect(place([{ country: null, city: "Munich" }]).capped).toBe(true);
    // A work mode none of the places it could be takes still conflicts.
    const onsite = place([{ country: "DE", city: null }], maria, "onsite");
    expect(onsite.capped).toBe(true);
    expect(onsite.verdicts[0]).toMatchObject({
      entryKey: "places",
      verdict: "conflicts",
      hard: true,
      reason: "DE, onsite — you accept 'Berlin, hybrid' only",
    });
  });

  it("a cap_score rule caps the score at 40 and is listed first", () => {
    const { match, ruleEffects, hidden } = matchRole(input({ rules: [capRule] }));
    expect(match.score).toBe(40);
    expect(match.capped).toBe(true);
    expect(match.verdicts[0]).toEqual({
      entryKey: null,
      ruleId: RULE_ID,
      verdict: "conflicts",
      reason: 'Fit score capped at 40 by your rule "Agencies score lower"',
      hard: true,
      need: null,
    });
    expect(ruleEffects.map((e) => e.action)).toEqual(["cap_score"]);
    expect(hidden).toBeNull();
  });

  it("lists every hard conflict before the rest, and a low score stays low", () => {
    const { match } = matchRole(
      input({
        facts: facts({ places: [{ country: "NL", city: "Amsterdam" }], extra: { x: "on-call" } }),
        rules: [capRule],
        ai: { ...titleFits, titleFit: { verdict: "conflicts", reason: "not backend" } },
        cv: { cvId: CV, skills: [] },
      }),
    );
    const hard = match.verdicts.findLastIndex((v) => v.hard);
    expect(match.verdicts.slice(0, hard + 1).every((v) => v.hard)).toBe(true);
    expect(match.verdicts.filter((v) => v.hard).map((v) => v.entryKey ?? v.ruleId)).toEqual([
      "places",
      "deal_breakers",
      RULE_ID,
    ]);
    expect(match.score).toBeLessThan(40);
  });

  it("a deal-breaker conflicts only in whole words, never inside a longer word", () => {
    const breakers = (words: string[]) => ({
      entries: [
        ...maria.entries.filter((e) => e.key !== "deal_breakers"),
        entry("deal_breakers", words),
      ],
    });
    const noConflict = (mine: string[], overrides: Partial<JobFacts>) => {
      const { match } = matchRole(input({ profile: breakers(mine), facts: facts(overrides) }));
      expect(match.capped).toBe(false);
      expect(
        match.verdicts.some((v) => v.entryKey === "deal_breakers" && v.verdict === "conflicts"),
      ).toBe(false);
      expect(byKey(match.verdicts, "deal_breakers")).toMatchObject({
        verdict: "fits",
        hard: false,
      });
    };
    noConflict(["crypto"], { skills: ["Go", "Cryptography"] });
    noConflict(["Java"], { skills: ["JavaScript", "TypeScript"] });
    noConflict(["on-call"], { extra: { duties: "Oncall-free team, calls on Mondays" } });
    noConflict(["Node"], { skills: ["Nodemailer"] });

    const conflict = (mine: string[], overrides: Partial<JobFacts>, hit: string) => {
      const { match } = matchRole(input({ profile: breakers(mine), facts: facts(overrides) }));
      expect(match.capped).toBe(true);
      expect(match.verdicts[0]).toMatchObject({
        entryKey: "deal_breakers",
        verdict: "conflicts",
        hard: true,
        reason: `Mentions '${hit}', one of your deal-breakers`,
      });
    };
    conflict(["on call"], { extra: { duties: "Weekly On-Call rotation." } }, "on call");
    conflict(["Java"], { skills: ["Java/Kotlin"] }, "Java");
    conflict(["crypto"], { company: "Crypto Exchange GmbH" }, "crypto");
    // A hyphen, dot or apostrophe is a word break: the deal-breaker is still there.
    conflict(["crypto"], { company: "Crypto-Exchange GmbH" }, "crypto");
    conflict(["Java"], { extra: { stack: "Java-based microservices" } }, "Java");
    conflict(["defense"], { company: "Defense-Tech AG" }, "defense");
    conflict(["gambling"], { extra: { sector: "the gambling's industry" } }, "gambling");
    conflict(["Node"], { skills: ["Node.js", "TypeScript"] }, "Node");
    conflict(["call"], { extra: { duties: "Weekly On-Call rotation" } }, "call");
  });

  it("a soft conflict doesn't cap: a language you don't list, a title that doesn't fit", () => {
    const { match } = matchRole(
      input({
        facts: facts({ languages: ["German"] }),
        ai: { ...titleFits, titleFit: { verdict: "conflicts", reason: "not backend" } },
      }),
    );
    expect(match.capped).toBe(false);
    expect(byKey(match.verdicts, "languages")).toMatchObject({
      verdict: "conflicts",
      hard: false,
      reason: "Asks for German — not among your working languages ('English', 'Portuguese')",
    });
  });
});

const chf = (min: number | null, max: number | null): NonNullable<JobFacts["pay"]> => ({
  min,
  max,
  currency: "CHF",
  period: "year",
  asWritten: "CHF 110–130k a year",
});

describe("pay only in the same currency and period (F4.3)", () => {
  it("is unknown in another currency, with the need a reply can't go without", () => {
    const { match } = matchRole(input({ facts: facts({ pay: chf(110000, 130000) }) }));
    expect(byKey(match.verdicts, "min_pay")).toEqual({
      entryKey: "min_pay",
      ruleId: null,
      verdict: "unknown",
      reason: "CHF 110–130k a year — different currency",
      hard: false,
      need: {
        profileKey: "min_pay",
        groupKey: "min_pay:CHF:year",
        question: "Minimum pay in CHF per year?",
        choices: [
          {
            label: "CHF 110,000 per year",
            value: {
              amount: 110000,
              currency: "CHF",
              period: "year",
              asWritten: "CHF 110,000 per year",
            },
          },
          {
            label: "CHF 130,000 per year",
            value: {
              amount: 130000,
              currency: "CHF",
              period: "year",
              asWritten: "CHF 130,000 per year",
            },
          },
        ],
      },
    });
    // No exchange rate is assumed: it is neither a fit nor a conflict, and the score isn't capped.
    expect(match.capped).toBe(false);
    expect(match.score).toBeGreaterThanOrEqual(70);
    expect(match.verdicts.filter((v) => v.need !== null)).toHaveLength(1);
  });

  it("is unknown in another period of the same currency", () => {
    const pay = {
      min: 6000,
      max: null,
      currency: "EUR",
      period: "month" as const,
      asWritten: "€6k",
    };
    const verdict = byKey(matchRole(input({ facts: facts({ pay }) })).match.verdicts, "min_pay");
    expect(verdict).toMatchObject({ verdict: "unknown", reason: "€6k — different period" });
    expect(verdict?.need).toMatchObject({
      groupKey: "min_pay:EUR:month",
      question: "Minimum pay in EUR per month?",
      choices: [{ label: "EUR 6,000 per month" }],
    });
  });

  it("compares a CHF role with the CHF minimum once there is one, and asks nothing", () => {
    const both = {
      entries: [
        ...maria.entries.filter((e) => e.key !== "min_pay"),
        entry("min_pay", [
          { amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" },
          { amount: 120000, currency: "CHF", period: "year", asWritten: "CHF 120,000 a year" },
        ]),
      ],
    };
    const fits = matchRole(input({ profile: both, facts: facts({ pay: chf(110000, 130000) }) }));
    expect(byKey(fits.match.verdicts, "min_pay")).toMatchObject({
      verdict: "fits",
      reason: "CHF 110–130k a year — meets your minimum of CHF 120,000 a year",
      need: null,
    });
    const below = matchRole(input({ profile: both, facts: facts({ pay: chf(90000, 100000) }) }));
    expect(byKey(below.match.verdicts, "min_pay")).toMatchObject({
      verdict: "conflicts",
      hard: true,
      need: null,
    });
    expect(below.match.score).toBeLessThanOrEqual(40);
  });

  it("asks nothing when the pay's currency, period or amount isn't stated", () => {
    const reasons = [
      { ...chf(100000, null), currency: null },
      { ...chf(100000, null), period: null },
      { ...chf(null, null), currency: "EUR" },
    ].map((pay) => byKey(matchRole(input({ facts: facts({ pay }) })).match.verdicts, "min_pay"));
    expect(reasons.map((v) => [v?.verdict, v?.reason, v?.need])).toEqual([
      ["unknown", "CHF 110–130k a year — pay currency not stated", null],
      ["unknown", "CHF 110–130k a year — pay period not stated", null],
      ["unknown", "CHF 110–130k a year — pay amount not stated", null],
    ]);
  });

  it("never takes a minimum alone for the most a role pays", () => {
    const eur = (min: number | null, max: number | null, asWritten: string) =>
      matchRole(
        input({ facts: facts({ pay: { min, max, currency: "EUR", period: "year", asWritten } }) }),
      ).match;
    // "From €50k" may go past your €70,000: unknown, not a conflict, and never capped.
    const from = eur(50000, null, "from €50k a year");
    expect(from.capped).toBe(false);
    expect(byKey(from.verdicts, "min_pay")).toMatchObject({
      verdict: "unknown",
      hard: false,
      reason: "from €50k a year — highest pay not stated",
      need: null,
    });
    // A minimum at or over yours meets it.
    expect(byKey(eur(70000, null, "from €70k").verdicts, "min_pay")).toMatchObject({
      verdict: "fits",
      reason: "from €70k — meets your minimum of €70,000 a year",
    });
    // "Up to" states the top: under yours, it is a hard conflict.
    const upTo = eur(null, 60000, "up to €60k");
    expect(upTo.capped).toBe(true);
    expect(upTo.verdicts[0]).toMatchObject({ entryKey: "min_pay", verdict: "conflicts" });
  });

  it("leaves pay out when the profile states no minimum", () => {
    const noPay = { entries: maria.entries.filter((e) => e.key !== "min_pay") };
    const { match } = matchRole(input({ profile: noPay, facts: facts({ pay: chf(1, 2) }) }));
    expect(byKey(match.verdicts, "min_pay")).toBeUndefined();
  });
});

describe("skills from the chosen CV and the profile (F4.4)", () => {
  it("counts a skill as matched only when the CV or the profile lists it", () => {
    const { match } = matchRole(input());
    // The model finds Kafka close to RabbitMQ; it still isn't in the CV, so it's missing.
    expect(match.skills).toEqual({ matched: ["Go", "PostgreSQL"], missing: ["Kafka"] });
  });

  it("adds the profile's own skills, and matches a skill written a little differently", () => {
    const withSkills = { entries: [...maria.entries, entry("extra.skills", ["Apache Kafka"])] };
    const { match } = matchRole(
      input({
        profile: withSkills,
        facts: facts({ skills: ["Go (Golang)", "postgresql", "Kafka", "Java"] }),
        cv: { cvId: CV, skills: ["Go", "PostgreSQL", "JavaScript"] },
      }),
    );
    // "Kafka" isn't "Apache Kafka" spelled out, and "Java" is no "JavaScript".
    expect(match.skills).toEqual({
      matched: ["Go (Golang)", "postgresql"],
      missing: ["Kafka", "Java"],
    });
  });

  it("never counts a skill as matched because a short CV skill sits inside it", () => {
    const skills = (cv: string[], role: string[]) =>
      matchRole(input({ facts: facts({ skills: role }), cv: { cvId: CV, skills: cv } })).match;
    const cases: [string, string][] = [
      ["C", "Objective-C"],
      ["Go", "Go-to-market strategy"],
      ["Testing", "Penetration testing"],
      ["Design", "System design"],
      ["Java", "Java EE"],
    ];
    for (const [cv, role] of cases) {
      const match = skills([cv], [role]);
      expect(match.skills, `${cv} against ${role}`).toEqual({ matched: [], missing: [role] });
      expect(match.verdicts.find((v) => v.entryKey === "extra.skills")?.verdict).toBe("conflicts");
    }
    // A missing skill earns no credit: the score is the same as with no CV skills at all.
    expect(skills(["Go"], ["Go-to-market strategy"]).score).toBe(
      skills([], ["Go-to-market strategy"]).score,
    );
    // The profile's own skills follow the same rule.
    const withSkills = { entries: [...maria.entries, entry("extra.skills", ["C", "Testing"])] };
    const { match } = matchRole(
      input({
        profile: withSkills,
        facts: facts({ skills: ["Objective-C", "Penetration testing", "c", "TESTING"] }),
        cv: { cvId: CV, skills: [] },
      }),
    );
    expect(match.skills).toEqual({
      matched: ["c", "TESTING"],
      missing: ["Objective-C", "Penetration testing"],
    });
  });

  it("matches the same skill with other spacing, punctuation or a parenthesised alias", () => {
    const { match } = matchRole(
      input({
        facts: facts({ skills: ["Node.js", "C#", "Go", "Kubernetes (K8s)", "C++"] }),
        cv: { cvId: CV, skills: ["NodeJS", "c#", "Go (Golang)", "Kubernetes", "C"] },
      }),
    );
    expect(match.skills).toEqual({
      matched: ["Node.js", "C#", "Go", "Kubernetes (K8s)"],
      missing: ["C++"],
    });
  });

  it("with no CV chosen, takes the skills from the profile alone", () => {
    const withSkills = { entries: [...maria.entries, entry("extra.skills", ["Go", "Kafka"])] };
    const { match } = matchRole(input({ profile: withSkills, cv: { cvId: null, skills: [] } }));
    expect(match.cvId).toBeNull();
    expect(match.skills).toEqual({ matched: ["Go", "Kafka"], missing: ["PostgreSQL"] });
    expect(match.verdicts[1]?.reason).toMatch(/^2 of 3 skills in your profile; /);
    const none = matchRole(input({ cv: { cvId: null, skills: [] } })).match;
    expect(none.skills).toEqual({ matched: [], missing: ["Go", "PostgreSQL", "Kafka"] });
    expect(none.verdicts[1]?.verdict).toBe("conflicts");
  });
});

describe("matchTaskInput", () => {
  it("holds exactly what match.v1 sees: the title and skills, target roles, skills, CV skills", () => {
    const withSkills = { entries: [...maria.entries, entry("extra.skills", ["Kafka"])] };
    const task = matchTaskInput({
      messageId: "<m@x.example>",
      position: 2,
      facts: facts(),
      profile: withSkills,
      cvSkills: ["Go"],
    });
    expect(task).toEqual({
      messageId: "<m@x.example>",
      position: 2,
      role: { title: "Senior Backend Engineer", skills: ["Go", "PostgreSQL", "Kafka"] },
      profile: { targetRoles: ["Backend Engineer", "Backend Developer"], skills: ["Kafka"] },
      cvSkills: ["Go"],
    });
    expect(needsMatchAi(task)).toBe(true);
    expect(needsMatchAi({ ...task, role: { title: null, skills: [] } })).toBe(false);
  });
});
