import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type JobFacts,
  JobFactsSchema,
  type ProfileEntry,
  ProfileEntrySchema,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { assignProfile, type ProfileCandidate } from "./index";

// F1.4's cross-check (D19): the real assignment over the roles MVP 3 S1 delivers (the Germany
// batch, e2e/fixtures/maria/deliveries.json step S1), against the ground truth written by hand in
// the persona sources, expected.json `mvp3.assignments`: München and Hamburg go to the new
// profile, the remote EU roles stay with the first.
//
// The profiles are Maria's two once S1 has confirmed the re-run, oldest first: the one she
// confirmed in MVP 1 S4 (her intake answers without Amsterdam, as packages/core's persona test
// builds it) and "Germany permanent" with what the re-run's intake form proposes
// (`mvp3.rerun.proposes`: German places, permanent, EUR per year). Rules play no part in the
// assignment. The facts are the fake AI's extract answers, which expected.json holds.

const FIXTURES = fileURLToPath(new URL("../../../../e2e/fixtures/", import.meta.url));
const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(`${FIXTURES}${path}`, "utf8")) as T;

const AT = "2026-10-15T12:00:00.000Z";

interface Expected {
  deliveries: Record<string, { facts: unknown[] | null }>;
  profile: { answers: Record<string, { values: unknown[] }> };
  mvp3: {
    profiles: { first: string; germany: string };
    assignments: Record<string, string>;
    rerun: { proposes: Record<string, unknown[]> };
  };
}

const expected = readJson<Expected>("maria/expected.json");
const deliveries = readJson<{ messageId: string; step: string }[]>("maria/deliveries.json");

const entry = (key: string, value: unknown): ProfileEntry =>
  ProfileEntrySchema.parse({
    key,
    label: key,
    value,
    confidence: null,
    evidence: [],
    source: "scan",
    updatedAt: AT,
    updatedBy: null,
  });

const first: ProfileCandidate = {
  profile: {
    id: "first",
    name: expected.mvp3.profiles.first,
    entries: Object.entries(expected.profile.answers).map(([key, { values }]) =>
      // MVP 1 S4: Maria removes Amsterdam from her places before confirming.
      entry(
        key,
        key === "places"
          ? values.filter((p) => (p as { city: string | null }).city !== "Amsterdam")
          : values,
      ),
    ),
  },
};

const germany: ProfileCandidate = {
  profile: {
    id: "germany",
    name: expected.mvp3.profiles.germany,
    entries: Object.entries(expected.mvp3.rerun.proposes).map(([key, values]) =>
      entry(key, values),
    ),
  },
};

describe("F1.4 against the fixtures' ground truth", () => {
  it("assigns every S1 role as expected.json's mvp3.assignments says", () => {
    const got: Record<string, string> = {};
    for (const { messageId } of deliveries.filter((d) => d.step === "S1")) {
      const truth = expected.deliveries[messageId];
      for (const [i, raw] of (truth?.facts ?? []).entries()) {
        const facts: JobFacts = JobFactsSchema.parse(raw);
        const assigned = assignProfile({
          facts,
          profiles: [first, germany],
          chosen: null,
        });
        got[`${messageId}#${i}`] = assigned?.name ?? "(none)";
      }
    }
    expect(Object.keys(got).length).toBeGreaterThan(0);
    expect(got).toEqual(expected.mvp3.assignments);
  });
});
