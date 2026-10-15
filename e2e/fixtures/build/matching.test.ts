import { describe, expect, it } from "vitest";
import type { JobFacts, ProfileValues } from "../format.ts";
import { hardConflicts, matchAnswer, type PersonaJudge } from "./matching.ts";

// The generator's hard conflicts follow the place and pay rules of the app's scorer
// (packages/core/src/match/match.ts), so a regenerated expected.json records what the app finds;
// its match.v1 answers judge each skill by the chosen CV.

const role = (over: Partial<JobFacts>): JobFacts => ({
  title: "Backend Engineer",
  company: "Example",
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
  ...over,
});

const profile = (over: Partial<ProfileValues>): ProfileValues => ({
  target_roles: [],
  seniority: [],
  places: [],
  remote: [],
  contracts: [],
  min_pay: [],
  languages: [],
  work_permits: [],
  reply_to: [],
  deal_breakers: [],
  ...over,
});

const BERLIN_HYBRID = { country: "DE", city: "Berlin", mode: "hybrid" as const };
const BERLIN_ONSITE = { country: "DE", city: "Berlin", mode: "onsite" as const };
const DE_HYBRID = { country: "DE", city: null, mode: "hybrid" as const };
const EU_REMOTE = { scope: "EU", timeZones: null };

describe("hardConflicts", () => {
  it("takes a role in a place of the profile in a mode it accepts", () => {
    const p = profile({ places: [BERLIN_HYBRID] });
    const berlin = [{ country: "DE", city: "Berlin" }];
    expect(hardConflicts(role({ places: berlin, workMode: "hybrid" }), p)).toEqual([]);
    // The city is compared without case or extra spaces.
    const spaced = [{ country: "DE", city: " berlin " }];
    expect(hardConflicts(role({ places: spaced, workMode: "hybrid" }), p)).toEqual([]);
  });

  it("takes a hybrid role where the profile takes onsite work, not an onsite role where only hybrid", () => {
    const berlin = [{ country: "DE", city: "Berlin" }];
    const onsite = profile({ places: [BERLIN_ONSITE] });
    expect(hardConflicts(role({ places: berlin, workMode: "hybrid" }), onsite)).toEqual([]);
    const hybrid = profile({ places: [BERLIN_HYBRID] });
    expect(hardConflicts(role({ places: berlin, workMode: "onsite" }), hybrid)).toEqual(["places"]);
  });

  it("matches a profile place with no city by country", () => {
    const p = profile({ places: [DE_HYBRID] });
    const munich = [{ country: "DE", city: "Munich" }];
    expect(hardConflicts(role({ places: munich, workMode: "hybrid" }), p)).toEqual([]);
    const paris = [{ country: "FR", city: "Paris" }];
    expect(hardConflicts(role({ places: paris, workMode: "hybrid" }), p)).toEqual(["places"]);
  });

  it("matches a role place with no country by city", () => {
    const p = profile({ places: [BERLIN_HYBRID] });
    const city = [{ country: null, city: "Berlin" }];
    expect(hardConflicts(role({ places: city, workMode: "hybrid" }), p)).toEqual([]);
  });

  it("conflicts on a named place that isn't one of the profile's", () => {
    const p = profile({ places: [BERLIN_HYBRID] });
    const amsterdam = [{ country: "NL", city: "Amsterdam" }];
    expect(hardConflicts(role({ places: amsterdam, workMode: "hybrid" }), p)).toEqual(["places"]);
  });

  it("with no place named, conflicts only on a work mode none of the profile's places takes", () => {
    const hybrid = profile({ places: [BERLIN_HYBRID] });
    expect(hardConflicts(role({ workMode: "onsite" }), hybrid)).toEqual(["places"]);
    expect(hardConflicts(role({ workMode: "hybrid" }), hybrid)).toEqual([]);
    const onsite = profile({ places: [BERLIN_ONSITE] });
    expect(hardConflicts(role({ workMode: "onsite" }), onsite)).toEqual([]);
  });

  it("never conflicts on place for a remote role or one with no work mode", () => {
    const p = profile({ places: [BERLIN_HYBRID] });
    const amsterdam = [{ country: "NL", city: "Amsterdam" }];
    expect(hardConflicts(role({ places: amsterdam, workMode: "remote" }), p)).toEqual([]);
    expect(hardConflicts(role({ places: amsterdam, workMode: null }), p)).toEqual([]);
  });

  it("with no places in the profile, conflicts on a named place only when it looks for remote work", () => {
    const amsterdam = [{ country: "NL", city: "Amsterdam" }];
    const onsite = role({ places: amsterdam, workMode: "onsite" });
    expect(hardConflicts(onsite, profile({}))).toEqual([]);
    expect(hardConflicts(onsite, profile({ remote: [EU_REMOTE] }))).toEqual(["places"]);
    expect(hardConflicts(role({ workMode: "onsite" }), profile({ remote: [EU_REMOTE] }))).toEqual(
      [],
    );
  });

  it("conflicts on pay whose top is below the minimum of the same currency and period", () => {
    const p = profile({
      min_pay: [{ amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" }],
    });
    const pay = (min: number | null, max: number | null, currency = "EUR") =>
      role({ pay: { min, max, currency, period: "year", asWritten: "" } });
    expect(hardConflicts(pay(50000, 65000), p)).toEqual(["min_pay"]);
    expect(hardConflicts(pay(50000, 70000), p)).toEqual([]);
    // A top below the minimum conflicts even with no bottom stated.
    expect(hardConflicts(pay(null, 65000), p)).toEqual(["min_pay"]);
    // With no top stated the scorer calls the pay unknown ("highest pay not stated"), never a
    // conflict, whether the bottom is under the minimum or not.
    expect(hardConflicts(pay(60000, null), p)).toEqual([]);
    expect(hardConflicts(pay(80000, null), p)).toEqual([]);
    expect(hardConflicts(pay(null, null), p)).toEqual([]);
    expect(hardConflicts(pay(50000, 65000, "GBP"), p)).toEqual([]);
  });

  it("lists places before pay", () => {
    const p = profile({
      places: [BERLIN_HYBRID],
      min_pay: [{ amount: 70000, currency: "EUR", period: "year", asWritten: "€70,000 a year" }],
    });
    const r = role({
      places: [{ country: "NL", city: "Amsterdam" }],
      workMode: "onsite",
      pay: { min: 40000, max: 50000, currency: "EUR", period: "year", asWritten: "" },
    });
    expect(hardConflicts(r, p)).toEqual(["places", "min_pay"]);
  });
});

describe("matchAnswer", () => {
  const judge: PersonaJudge = {
    persona: "maria",
    profile: profile({}),
    cvFor: () => ({ name: "Backend (EN)", skills: ["Go"] }),
    titleFit: () => ({ verdict: "fits", reason: "a backend role" }),
  };
  const cv = { name: "Backend (EN)", skills: ["go"] };

  it("calls a CV skill a fit and any other skill unknown, unless it is named close", () => {
    const r = role({ skills: ["Go", "Redis", "Java"] });
    expect(matchAnswer(judge, r, cv).skillCloseness.map((s) => s.verdict)).toEqual([
      "fits",
      "unknown",
      "unknown",
    ]);
    const close = matchAnswer(judge, r, cv, { Redis: "close to PostgreSQL" }).skillCloseness;
    expect(close.map((s) => [s.skill, s.verdict])).toEqual([
      ["Go", "fits"],
      ["Redis", "fits"],
      ["Java", "unknown"],
    ]);
    expect(close[1]?.reason).toBe("close to PostgreSQL");
  });
});
