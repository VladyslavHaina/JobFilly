import type { JobFacts, ProfileEntry, Rule } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../rules/engine";
import { assignProfile, type ProfileCandidate } from "./index";

// Which profile a role belongs to (MVP 3, F1.3), pure: the best profile that is on by places,
// title, languages and contract (rules play no part), ties to the oldest, an editor's choice
// first; always with the reason in words.

const AT = "2026-10-15T12:00:00.000Z";

const entry = (key: ProfileEntry["key"], value: ProfileEntry["value"]): ProfileEntry => ({
  key,
  label: key,
  value,
  confidence: null,
  evidence: [],
  source: "scan",
  updatedAt: AT,
  updatedBy: null,
});

const facts = (overrides: Partial<JobFacts>): JobFacts => ({
  title: "Backend Engineer",
  company: null,
  agency: null,
  places: [],
  workMode: null,
  remoteScope: null,
  timeZones: null,
  pay: null,
  contract: null,
  seniority: null,
  workPermit: null,
  skills: [],
  languages: [],
  applyUrl: null,
  extra: {},
  ...overrides,
});

const candidate = (id: string, name: string, entries: ProfileEntry[]) => ({
  profile: { id, name, entries },
});

const REMOTE_EU: ProfileCandidate = candidate("p1", "Remote EU", [
  entry("target_roles", ["Backend Engineer"]),
  entry("places", [{ country: "DE", city: "Berlin", mode: "hybrid" }]),
  entry("remote", [{ scope: "EU", timeZones: null }]),
  entry("languages", ["English", "Portuguese"]),
  entry("contracts", ["permanent", "B2B"]),
]);
const GERMANY: ProfileCandidate = candidate("p2", "Germany permanent", [
  entry("places", [
    { country: "DE", city: "Munich", mode: "onsite" },
    { country: "DE", city: null, mode: "hybrid" },
  ]),
  entry("languages", ["German"]),
  entry("contracts", ["permanent"]),
]);

const assign = (role: JobFacts, profiles = [REMOTE_EU, GERMANY], chosen: string | null = null) =>
  assignProfile({
    facts: role,
    profiles,
    chosen,
  });

describe("assignProfile", () => {
  it("puts a Munich role in German, permanent, in the Germany profile, saying why", () => {
    expect(
      assign(
        facts({
          places: [{ country: "DE", city: "Munich" }],
          workMode: "onsite",
          languages: ["German"],
          contract: "Permanent",
        }),
      ),
    ).toEqual({
      profileId: "p2",
      name: "Germany permanent",
      reason: "Munich role, German, permanent → 'Germany permanent'",
      source: "auto",
    });
  });

  it("keeps a remote EU role with the profile that works remotely", () => {
    expect(
      assign(
        facts({
          workMode: "remote",
          remoteScope: "EU",
          places: [{ country: "DE", city: "Munich" }],
        }),
      ),
    ).toMatchObject({ profileId: "p1", reason: "Remote role, Backend Engineer → 'Remote EU'" });
  });

  it("weighs a city the profile names over a whole country", () => {
    const berlin = facts({ places: [{ country: "DE", city: "Berlin" }], workMode: "hybrid" });
    expect(assign(berlin)).toMatchObject({ profileId: "p1" });
    const hamburg = facts({
      title: "Data Engineer",
      places: [{ country: "DE", city: "Hamburg" }],
      workMode: "hybrid",
    });
    expect(assign(hamburg)).toMatchObject({
      profileId: "p2",
      reason: "Hamburg role → 'Germany permanent'",
    });
  });

  it("gives a tie to the oldest profile, and says when nothing tells them apart", () => {
    expect(assign(facts({ title: null }))).toMatchObject({
      profileId: "p1",
      reason: "No other profile fits it better → 'Remote EU'",
    });
    expect(assign(facts({ title: null }), [GERMANY])).toMatchObject({
      profileId: "p2",
      reason: "The only profile that is on → 'Germany permanent'",
    });
  });

  it("ignores rules: a role stays with the profile it fits best, whose hide rule then hides it", () => {
    const hideGermany: Rule = {
      id: "6f1c2f4e-8d3a-4b5c-9e7f-0a1b2c3d4e5f",
      profileId: "p2",
      description: "Hide roles in Germany",
      when: [{ fact: "places.country", op: "in", value: ["DE"] }],
      then: "hide",
      enabled: true,
      source: "you",
      createdAt: AT,
      createdBy: null,
    };
    const hiding = { ...GERMANY, rules: [hideGermany] };
    const munich = facts({ places: [{ country: "DE", city: "Munich" }], workMode: "onsite" });
    // It is not moved to the profile without the rule…
    expect(assign(munich, [REMOTE_EU, hiding])).toMatchObject({ profileId: "p2" });
    // …and the assigned profile's rule hides it there (the match stage applies it).
    const ctx = { facts: munich, senderAddress: "jobs@agency.example", category: null };
    expect(evaluateRules(hiding.rules, ctx).hidden).toMatchObject({ ruleId: hideGermany.id });
  });

  it("follows an editor's choice of a profile that is on, and none without profiles", () => {
    const remote = facts({ workMode: "remote" });
    expect(assign(remote, [REMOTE_EU, GERMANY], "p2")).toEqual({
      profileId: "p2",
      name: "Germany permanent",
      reason: "Chosen by hand → 'Germany permanent'",
      source: "you",
    });
    // A choice of a profile that isn't on is set aside.
    expect(assign(remote, [REMOTE_EU], "p2")).toMatchObject({ profileId: "p1", source: "auto" });
    expect(assign(remote, [])).toBeNull();
  });
});
