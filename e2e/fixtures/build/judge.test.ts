import { describe, expect, it } from "vitest";
import type { JobFacts } from "../format.ts";
import { matchAnswer, type PersonaJudge } from "./judge.ts";

// The generator's match.v1 answers judge each skill by the chosen CV.

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

describe("matchAnswer", () => {
  const judge: PersonaJudge = {
    persona: "maria",
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
