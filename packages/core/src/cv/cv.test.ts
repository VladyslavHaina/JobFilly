import type { CvTag } from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { type CvCandidate, chooseCv } from "./choice";
import { checkSkills, tagsAfterRead } from "./skills";

describe("the skill check (F2.2)", () => {
  const text = "Maria Santos\nSkills: Go, PostgreSQL,  Kubernetes\nSpring\n  Boot · C++ · Node.js";

  it("keeps the skills the text contains, matching case and whitespace leniently", () => {
    const result = checkSkills(["go", "POSTGRESQL", "Spring Boot", "c++", "Node.js"], text);
    expect(result).toEqual({
      kept: ["go", "POSTGRESQL", "Spring Boot", "c++", "Node.js"],
      dropped: [],
    });
  });

  it("drops a skill that isn't in the text and reports it", () => {
    expect(checkSkills(["Go", "Rust", "Kubernetes"], text)).toEqual({
      kept: ["Go", "Kubernetes"],
      dropped: ["Rust"],
    });
  });

  it("only matches a skill as a word of its own", () => {
    expect(
      checkSkills(["Go", "SQL", "Java"], "Worked at Google with MySQL and JavaScript"),
    ).toEqual({ kept: [], dropped: ["Go", "SQL", "Java"] });
  });

  it("lists each skill once and ignores empty ones", () => {
    expect(checkSkills(["Go", "go ", "  "], "Go")).toEqual({ kept: ["Go"], dropped: [] });
  });
});

describe("the tags a read suggests (F2.1)", () => {
  it("adds the language code, role families and seniority as ai tags, keeping the user's", () => {
    const existing: CvTag[] = [
      { label: "old guess", source: "ai" },
      { label: "preferred", source: "you" },
      { label: "senior", source: "you" },
    ];
    expect(
      tagsAfterRead(
        {
          language: "de",
          skills: ["Go"],
          roleFamilies: ["Backend engineering"],
          seniority: "Senior",
          countryHints: ["DE"],
          formatHints: ["one page"],
        },
        existing,
      ),
    ).toEqual([
      { label: "de", source: "ai" },
      { label: "Backend engineering", source: "ai" },
      { label: "Senior", source: "ai" },
      { label: "preferred", source: "you" },
    ]);
  });

  it("matches the suggested tags of the e2e fixtures", () => {
    const labels = tagsAfterRead(
      {
        language: "EN",
        skills: ["Go"],
        roleFamilies: ["Backend engineering"],
        seniority: "Senior",
        countryHints: ["PT"],
        formatHints: ["one page", "no photo"],
      },
      [],
    ).map((t) => t.label);
    expect(labels).toEqual(["en", "Backend engineering", "Senior"]);
  });

  it("leaves out an unknown language code", () => {
    const tags = tagsAfterRead(
      {
        language: "zz-not-a-code",
        skills: [],
        roleFamilies: [],
        seniority: null,
        countryHints: [],
        formatHints: [],
      },
      [],
    );
    expect(tags).toEqual([]);
  });
});

const tag = (label: string, source: CvTag["source"] = "ai"): CvTag => ({ label, source });

const backendEn: CvCandidate = {
  id: "cv-backend-en",
  name: "Backend (EN)",
  language: "en",
  skills: ["Go", "PostgreSQL", "Kubernetes"],
  roleFamilies: ["Backend engineering"],
  seniority: "Senior",
  tags: [tag("en"), tag("Backend engineering"), tag("Senior")],
};
const backendDe: CvCandidate = {
  id: "cv-backend-de",
  name: "Backend (DE)",
  language: "de",
  skills: ["Go", "PostgreSQL", "Kubernetes"],
  roleFamilies: ["Backend engineering"],
  seniority: "Senior",
  tags: [tag("de"), tag("Backend engineering"), tag("Senior")],
};
const dataEn: CvCandidate = {
  id: "cv-data-en",
  name: "Data engineering (EN)",
  language: "en",
  skills: ["Python", "Airflow", "Spark", "PostgreSQL"],
  roleFamilies: ["Data engineering"],
  seniority: "Senior",
  tags: [tag("en"), tag("Data engineering"), tag("Senior")],
};
const all = [backendEn, backendDe, dataEn];

const role = (title: string, skills: string[] = [], seniority: string | null = null) => ({
  title,
  skills,
  seniority,
});

describe("the CV choice per role (F2.3)", () => {
  it("chooses the German backend CV for a German backend role, and says why", () => {
    const choice = chooseCv({
      role: role("Senior Backend-Entwickler (m/w/d)", ["Go", "PostgreSQL"], "Senior"),
      language: "de",
      cvs: all,
      override: null,
    });
    expect(choice).toEqual({
      cv: backendDe,
      reason: "German backend role → Backend (DE)",
      source: "auto",
    });
  });

  it("chooses by language when the role family is the same", () => {
    const choice = chooseCv({
      role: role("Backend Engineer", ["Go"]),
      language: "en",
      cvs: all,
      override: null,
    });
    expect(choice.cv?.name).toBe("Backend (EN)");
    expect(choice.reason).toBe("English backend role → Backend (EN)");
  });

  it("chooses by role family: a data role gets the data engineering CV", () => {
    const choice = chooseCv({
      role: role("Data Engineer", ["Python", "Spark"]),
      language: "en",
      cvs: [backendEn, backendDe, dataEn],
      override: null,
    });
    expect(choice.cv?.id).toBe(dataEn.id);
    expect(choice.reason).toBe("English data role → Data engineering (EN)");
  });

  it("lets a CV tagged preferred win a tie, and names the tag", () => {
    const preferred = { ...backendDe, tags: [...backendDe.tags, tag("preferred", "you")] };
    const choice = chooseCv({
      role: role("Platform Engineer"),
      language: null,
      cvs: [backendEn, preferred],
      override: null,
    });
    expect(choice.cv?.id).toBe(backendDe.id);
    expect(choice.reason).toBe(
      "Nothing in this role points to another CV → Backend (DE), tagged preferred",
    );
  });

  it("uses role families when a CV has no tags, and seniority as a tie-breaker", () => {
    const junior = {
      ...dataEn,
      id: "junior",
      name: "Data (junior)",
      seniority: "Junior",
      tags: [],
    };
    const senior = { ...dataEn, id: "senior", name: "Data (senior)", tags: [] };
    const choice = chooseCv({
      role: role("Senior Data Engineer"),
      language: null,
      cvs: [junior, senior],
      override: null,
    });
    expect(choice.cv?.id).toBe("senior");
    expect(choice.reason).toBe("Data role → Data (senior)");
  });

  it("lets a role family the title names outweigh the language", () => {
    const choice = chooseCv({
      role: role("Senior Data Engineer (m/w/d)"),
      language: "de",
      cvs: all,
      override: null,
    });
    expect(choice.cv?.id).toBe(dataEn.id);
    expect(choice.reason).toBe("Data role → Data engineering (EN)");
  });

  it("needs every word of a family: one word in common doesn't make it that family's role", () => {
    // The scam of the e2e fixtures: "data" alone doesn't make it a data engineering role.
    const preferred = { ...backendEn, tags: [...backendEn.tags, tag("preferred", "you")] };
    const choice = chooseCv({
      role: role("Remote Data Entry Assistant"),
      language: "en",
      cvs: [preferred, backendDe, dataEn],
      override: null,
    });
    expect(choice.cv?.id).toBe(backendEn.id);
    expect(choice.reason).toBe("English role → Backend (EN), tagged preferred");
    // Without the tag the one word still counts for a little, as much as one skill.
    expect(
      chooseCv({
        role: role("Python Backend Developer", ["Python"]),
        language: "en",
        cvs: all,
        override: null,
      }).cv?.id,
    ).toBe(backendEn.id);
  });

  it.each([
    ["API Engineer", ["Python", "Kafka", "AWS", "Kotlin"]],
    ["Site Reliability Engineer", ["TypeScript", "Python", "PostgreSQL", "Kotlin"]],
    ["Software Engineer, Payments", ["TypeScript", "Python", "PostgreSQL", "AWS"]],
  ])("lets the preferred CV outweigh one skill more for %s", (title, skills) => {
    const backend = { ...backendEn, skills: [...backendEn.skills, "Kafka"] };
    const data = { ...dataEn, skills: [...dataEn.skills, "Kafka"] };
    const preferred = { ...backend, tags: [...backend.tags, tag("preferred", "you")] };
    const input = { role: role(title, skills), language: "en", override: null };
    // Untagged, the CV with more of the role's skills wins.
    expect(chooseCv({ ...input, cvs: [backend, backendDe, data] }).cv?.id).toBe(dataEn.id);
    expect(chooseCv({ ...input, cvs: [preferred, backendDe, data] })).toMatchObject({
      cv: { id: backendEn.id },
      reason: "English role → Backend (EN), tagged preferred",
    });
  });

  it("honours tags the user removed: a family no longer tagged no longer counts", () => {
    const untagged = { ...dataEn, tags: [tag("en"), tag("Senior")] };
    const choice = chooseCv({
      role: role("Data Engineer"),
      language: "en",
      cvs: [backendEn, untagged],
      override: null,
    });
    expect(choice.cv?.id).toBe(backendEn.id);
  });

  it("falls back to matched skills, then to the first CV, always with a reason", () => {
    expect(
      chooseCv({ role: role("Engineer", ["Airflow"]), language: null, cvs: all, override: null })
        .reason,
    ).toBe("Role asks for Airflow → Data engineering (EN)");
    expect(
      chooseCv({ role: role("Engineer"), language: "fr", cvs: all, override: null }).reason,
    ).toBe("Nothing in this role points to one CV → Backend (EN), your first");
    expect(
      chooseCv({ role: role("Engineer"), language: null, cvs: [dataEn], override: null }).reason,
    ).toBe("Your only CV → Data engineering (EN)");
  });

  it("gives an editor's override precedence, as long as that CV still exists", () => {
    const input = {
      role: role("Backend Engineer"),
      language: "de",
      cvs: all,
      override: dataEn.id,
    };
    expect(chooseCv(input)).toEqual({
      cv: dataEn,
      reason: "You chose Data engineering (EN) for this role",
      source: "you",
    });
    expect(chooseCv({ ...input, override: "deleted" }).cv?.id).toBe(backendDe.id);
  });

  it("chooses nothing when there is no CV", () => {
    expect(chooseCv({ role: role("Backend"), language: "en", cvs: [], override: null })).toEqual({
      cv: null,
      reason: "No CV uploaded yet",
      source: "auto",
    });
  });
});
