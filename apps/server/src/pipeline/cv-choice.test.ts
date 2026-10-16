import { createConfirmedProfile, deleteCv, loadMessageInputs, setRoleCvChoice } from "@jobfilly/db";
import type { Profile } from "@jobfilly/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeMailbox,
  createTestDeps,
  type FakeMailbox,
  roleFacts,
  type SeededUser,
  seedCv,
  seedJobMail,
  seedUser,
  type TestDeps,
} from "../testing";
import { cvChoiceStage } from "./cv-choice";
import type { CvChoiceResult, MessageInput, StageContext } from "./stages";

// The cv-choice stage (F2.3): the pinned CvChoiceResult {cvId, name, language, skills, reason,
// source}, from the profile's CVs, the role's facts and the message's stored language, with an
// editor's choice for the role winning; cvId null when the profile has no CV.

const NOW = new Date("2026-10-15T12:00:00Z");

let deps: TestDeps;
let mailbox: FakeMailbox;
let maria: SeededUser;
let ws: string;
let profile: Profile;

beforeEach(async () => {
  deps = await createTestDeps({ now: NOW });
  mailbox = createFakeMailbox();
  maria = await seedUser(deps);
  ws = maria.workspaceId;
  const created = await createConfirmedProfile(deps.db, ws, {
    name: "My job search",
    entries: [],
    createdBy: maria.id,
    at: NOW,
  });
  if (!created.ok) throw new Error("expected a profile");
  profile = created.profile;
});
afterEach(() => deps.close());

function context(withProfile: Profile | null = profile): StageContext {
  return {
    deps,
    ws,
    profile: withProfile,
    rules: [],
    now: NOW,
    origin: "reevaluate",
    body: () => Promise.reject(new Error("the cv-choice stage never reads the mailbox")),
    original: () => Promise.reject(new Error("the cv-choice stage never reads the mailbox")),
    log: deps.log,
  };
}

async function message(language: string | null, title = "Senior Backend-Entwickler (m/w/d)") {
  await seedJobMail(deps, ws, mailbox, {
    messageId: "<berlin@rheinpfad.example>",
    receivedAt: NOW,
    roles: [roleFacts({ title, skills: ["Go", "PostgreSQL"] })],
  });
  const [input] = await loadMessageInputs(deps.db, ws, ["<berlin@rheinpfad.example>"]);
  if (!input) throw new Error("expected the message");
  return { ...input, language } satisfies MessageInput;
}

const choose = async (input: MessageInput): Promise<CvChoiceResult> =>
  cvChoiceStage(
    { message: input, role: { position: 0, facts: input.facts[0] ?? roleFacts() } },
    context(),
  );

async function mariasCvs() {
  const en = await seedCv(deps, ws, {
    name: "Backend (EN)",
    language: "en",
    skills: ["Go", "PostgreSQL", "Kubernetes"],
    roleFamilies: ["Backend engineering"],
    seniority: "Senior",
    tags: [{ label: "Backend engineering", source: "ai" }],
    preferred: true,
    profileId: profile.id,
  });
  deps.clock.advance(1000);
  const de = await seedCv(deps, ws, {
    name: "Backend (DE)",
    language: "de",
    skills: ["Go", "PostgreSQL"],
    roleFamilies: ["Backend engineering"],
    seniority: "Senior",
    tags: [{ label: "Backend engineering", source: "ai" }],
    profileId: profile.id,
  });
  return { en, de };
}

describe("the cv-choice stage", () => {
  it("chooses the German backend CV for a German backend role, with its reason", async () => {
    const { de } = await mariasCvs();
    expect(await choose(await message("de"))).toEqual({
      cvId: de.id,
      name: "Backend (DE)",
      language: "de",
      skills: ["Go", "PostgreSQL"],
      reason: "German backend role → Backend (DE)",
      source: "auto",
    });
  });

  it("reads the message's stored language: an English message gets the English CV", async () => {
    const { en } = await mariasCvs();
    const choice = await choose(await message("en", "Backend Engineer"));
    expect(choice).toMatchObject({ cvId: en.id, name: "Backend (EN)", source: "auto" });
    expect(choice.reason).toBe("English backend role → Backend (EN), your preferred CV");
  });

  it("gives an editor's choice for the role precedence", async () => {
    const { en } = await mariasCvs();
    const input = await message("de");
    await setRoleCvChoice(deps.db, ws, {
      messageId: input.messageId,
      position: 0,
      cvId: en.id,
      userId: maria.id,
      at: NOW,
    });
    expect(await choose(input)).toEqual({
      cvId: en.id,
      name: "Backend (EN)",
      language: "en",
      skills: ["Go", "PostgreSQL", "Kubernetes"],
      reason: "You chose Backend (EN) for this role",
      source: "you",
    });
  });

  it("leaves a deleted CV: the role gets the automatic choice among the rest", async () => {
    const { en, de } = await mariasCvs();
    const input = await message("de");
    await setRoleCvChoice(deps.db, ws, {
      messageId: input.messageId,
      position: 0,
      cvId: en.id,
      userId: maria.id,
      at: NOW,
    });
    expect(await deleteCv(deps.db, ws, en.id)).toBe(true);
    expect(await choose(input)).toMatchObject({ cvId: de.id, source: "auto" });
    expect(await deleteCv(deps.db, ws, de.id)).toBe(true);
    expect(await choose(input)).toMatchObject({ cvId: null, reason: "No CV uploaded yet" });
  });

  it("refuses to choose without a confirmed profile, never from all the CVs", async () => {
    await mariasCvs();
    const input = await message("de");
    await expect(
      cvChoiceStage({ message: input, role: { position: 0, facts: roleFacts() } }, context(null)),
    ).rejects.toThrow("confirmed profile");
  });

  it("gives cvId null when the profile has no CV", async () => {
    const other = await seedUser(deps);
    await seedCv(deps, other.workspaceId, { name: "Tom's CV", language: "de" });
    expect(await choose(await message("de"))).toEqual({
      cvId: null,
      name: null,
      language: null,
      skills: [],
      reason: "No CV uploaded yet",
      source: "auto",
    });
  });
});
