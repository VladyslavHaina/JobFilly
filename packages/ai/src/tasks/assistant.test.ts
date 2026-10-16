import { describe, expect, it } from "vitest";
import { assistantPrompt } from "./assistant";

// assistant.v1's instruction (F8): replies in the user's language, proposals made only of rule
// and profile-entry changes, a clarifying question instead of a guess, and what it can't do with
// where that is done. The pinned key line and framing are tested in ../tasks.test.ts.

const { system, user } = assistantPrompt({
  turn: 2,
  text: "Schick meine Antwort an den Recruiter in Berlin",
  history: [{ role: "user", text: "Hallo" }],
  entries: [],
  rules: [],
});

describe("assistant.v1's instruction", () => {
  it("answers in the language of the user's message (F8.1)", () => {
    expect(system).toContain("in the language of the user's message");
  });

  it("proposes only changes to rules and profile entries, nothing applied (F8.2)", () => {
    expect(system).toContain("adds, updates or removes a rule (by its id) or a profile entry");
    expect(system).toContain("never say a change is made");
  });

  it("asks one clarifying question with choices instead of guessing (F8.6)", () => {
    expect(system).toMatch(/unclear.*`clarify`.*`choices`.*never guess/);
  });

  it("says what it can't do and where each is done (F8.7)", () => {
    expect(system).toContain(
      "You can't send mail, invite people, change mailboxes or AI settings, or delete data.",
    );
    for (const where of ["Drafts page", "Members page", "under Settings", "CVs page"]) {
      expect(system).toContain(where);
    }
  });

  it("keeps the instruction out of the user message", () => {
    expect(user).not.toContain("You can't send mail");
    expect(user.split("\n").slice(0, 2)).toEqual(["task: assistant.v1", "Turn: 2"]);
  });
});
