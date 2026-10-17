import { describe, expect, it } from "vitest";
import {
  MAX_SCAN_HINT_LENGTH,
  ProfilePatchSchema,
  ProfileSchema,
  RoleProfileInputSchema,
  RoleProfileSchema,
  ScanFocusSchema,
  ScanKindSchema,
  StartScanInputSchema,
} from "./index";

// The shapes MVP 3 adds to the shared contract (docs/mvp/MVP-3.md). The slices that build on them
// test their behaviour; these pin the shapes themselves.

const ID = "6f1c2f4e-8d3a-4b5c-9e7f-0a1b2c3d4e5f";

describe("several profiles and re-running setup (F1)", () => {
  it("knows the re-run scan kind", () => {
    expect(ScanKindSchema.options).toEqual(["first", "analyze_rest", "rerun"]);
  });

  it("starts the first scan when POST /scans names no kind", () => {
    expect(StartScanInputSchema.parse({})).toEqual({ kind: "first" });
  });

  it("takes a re-run with a trimmed hint of at most 500 characters", () => {
    expect(
      StartScanInputSchema.parse({ kind: "rerun", hint: "  I've moved to Germany  " }),
    ).toEqual({ kind: "rerun", hint: "I've moved to Germany" });
    expect(
      StartScanInputSchema.safeParse({ kind: "rerun", hint: "x".repeat(MAX_SCAN_HINT_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(StartScanInputSchema.safeParse({ kind: "analyze_rest" }).success).toBe(false);
  });

  it("reads a hint's focus with international codes only", () => {
    const focus = {
      countries: ["DE"],
      cities: [],
      languages: ["de"],
      workModes: ["onsite", "hybrid"],
      contracts: ["permanent"],
      words: [],
    };
    expect(ScanFocusSchema.parse(focus)).toEqual(focus);
    expect(ScanFocusSchema.safeParse({ ...focus, countries: ["Germany"] }).success).toBe(false);
    expect(ScanFocusSchema.safeParse({ ...focus, languages: ["German"] }).success).toBe(false);
  });

  it("reads a profile without `enabled` (a previous replica's answer) and takes it in a patch", () => {
    const profile = {
      id: ID,
      workspaceId: ID,
      name: "My job search",
      entries: [],
      confirmedAt: null,
    };
    expect(ProfileSchema.parse(profile)).toEqual(profile);
    expect(ProfileSchema.parse({ ...profile, enabled: false }).enabled).toBe(false);
    expect(ProfilePatchSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("says which profile a role belongs to, by the app or by hand", () => {
    const assigned = {
      profileId: ID,
      name: "Germany permanent",
      reason: "Munich role",
      source: "auto",
    };
    expect(RoleProfileSchema.parse(assigned)).toEqual(assigned);
    expect(RoleProfileSchema.safeParse({ ...assigned, source: "rule" }).success).toBe(false);
    expect(RoleProfileInputSchema.safeParse({ profileId: "nope" }).success).toBe(false);
  });
});
