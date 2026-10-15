import type { CvAnswer, Persona } from "../format.ts";
import { type DocLine, docxDocument, pdfDocument } from "./documents.ts";

// The personas' CVs (MVP 2 › Fixtures added): Maria's "Backend (EN)" PDF, "Backend (DE)" DOCX
// and "Data engineering (EN)" PDF, Tom's "Nurse (EN)" DOCX. Each has the words it shows and the
// fake AI's cv.v1 answer. Every skill of an answer is written in the CV, except the one skill the
// "Data engineering (EN)" answer invents, which the skill check must drop (F2.2).

export interface CvSource {
  persona: Persona;
  /** The file under <persona>/cvs/. */
  file: string;
  /** The name shown in the app. */
  name: string;
  mediaType: "pdf" | "docx";
  lines: DocLine[];
  answer: CvAnswer;
  /** The skill the answer invents (F2.2); every other skill is in `lines`. */
  inventedSkill?: string;
}

const h = (text: string): DocLine => ({ text, heading: true });
const p = (text: string): DocLine => ({ text });
const blank: DocLine = { text: "" };

const BACKEND_SKILLS = ["Go", "PostgreSQL", "Kubernetes", "Kafka", "gRPC", "Docker", "Terraform"];

const backendEn: CvSource = {
  persona: "maria",
  file: "backend-en.pdf",
  name: "Backend (EN)",
  mediaType: "pdf",
  lines: [
    h("Maria Santos"),
    p("Senior Backend Engineer - Lisbon, Portugal"),
    p("maria.santos@inbox.example"),
    blank,
    h("Summary"),
    p("Backend engineer with nine years of experience building payment and logistics"),
    p("platforms. I design services that stay fast and correct under load, and I like"),
    p("teams that write things down."),
    blank,
    h("Skills"),
    p(BACKEND_SKILLS.join(", ")),
    blank,
    h("Experience"),
    p("2021 - today: Senior Backend Engineer, Tejo Payments (Lisbon)"),
    p("Built the settlement service in Go on PostgreSQL; moved twelve services to Kubernetes."),
    p("Introduced Kafka for payment events and gRPC between services."),
    p("2017 - 2021: Backend Engineer, Ribeira Logistics (Porto)"),
    p("Wrote the routing API and its Docker build; managed the AWS setup with Terraform."),
    blank,
    h("Education"),
    p("MSc in Computer Science, 2016"),
    blank,
    h("Languages"),
    p("Portuguese (native), English (fluent), German (good working knowledge)"),
  ],
  answer: {
    language: "en",
    skills: BACKEND_SKILLS,
    roleFamilies: ["Backend engineering"],
    seniority: "Senior",
    countryHints: ["PT"],
    formatHints: ["one page", "no photo"],
  },
};

const backendDe: CvSource = {
  persona: "maria",
  file: "backend-de.docx",
  name: "Backend (DE)",
  mediaType: "docx",
  lines: [
    h("Maria Santos"),
    p("Senior Backend-Entwicklerin – Lissabon, Portugal"),
    p("maria.santos@inbox.example"),
    blank,
    h("Profil"),
    p(
      "Backend-Entwicklerin mit neun Jahren Erfahrung mit Zahlungs- und Logistikplattformen. Ich entwickle Dienste, die auch unter Last schnell und korrekt bleiben.",
    ),
    blank,
    h("Kenntnisse"),
    p(BACKEND_SKILLS.join(", ")),
    blank,
    h("Berufserfahrung"),
    p("2021 – heute: Senior Backend-Entwicklerin, Tejo Payments (Lissabon)"),
    p(
      "Abrechnungsdienst in Go mit PostgreSQL aufgebaut; zwölf Dienste nach Kubernetes migriert; Kafka für Zahlungsereignisse und gRPC zwischen Diensten eingeführt.",
    ),
    p("2017 – 2021: Backend-Entwicklerin, Ribeira Logistics (Porto)"),
    p("Routing-API und ihren Docker-Build entwickelt; AWS-Umgebung mit Terraform verwaltet."),
    blank,
    h("Ausbildung"),
    p("Master in Informatik, 2016"),
    blank,
    h("Sprachen"),
    p("Portugiesisch (Muttersprache), Englisch (fließend), Deutsch (gute Kenntnisse)"),
  ],
  answer: {
    language: "de",
    skills: BACKEND_SKILLS,
    roleFamilies: ["Backend engineering"],
    seniority: "Senior",
    countryHints: ["PT"],
    formatHints: ["one page", "no photo"],
  },
};

const DATA_SKILLS = ["Python", "SQL", "Apache Airflow", "dbt", "PostgreSQL", "Kafka"];

const dataEn: CvSource = {
  persona: "maria",
  file: "data-engineering-en.pdf",
  name: "Data engineering (EN)",
  mediaType: "pdf",
  lines: [
    h("Maria Santos"),
    p("Data Engineer - Lisbon, Portugal"),
    p("maria.santos@inbox.example"),
    blank,
    h("Summary"),
    p("Engineer with nine years of backend work, the last four of them building the data"),
    p("pipelines behind payment reporting."),
    blank,
    h("Skills"),
    p(DATA_SKILLS.join(", ")),
    blank,
    h("Experience"),
    p("2021 - today: Senior Backend Engineer, Tejo Payments (Lisbon)"),
    p("Built the reporting pipelines in Python and SQL, scheduled with Apache Airflow;"),
    p("modelled the warehouse with dbt on PostgreSQL; streamed payment events from Kafka."),
    p("2017 - 2021: Backend Engineer, Ribeira Logistics (Porto)"),
    p("Wrote the nightly exports that fed the planning team's dashboards."),
    blank,
    h("Languages"),
    p("Portuguese (native), English (fluent)"),
  ],
  answer: {
    language: "en",
    skills: [...DATA_SKILLS, "Snowflake"],
    roleFamilies: ["Data engineering"],
    seniority: "Senior",
    countryHints: ["PT"],
    formatHints: ["one page", "no photo"],
  },
  inventedSkill: "Snowflake",
};

const NURSE_SKILLS = [
  "Patient assessment",
  "Medication administration",
  "Wound care",
  "IV therapy",
  "Triage",
];

const nurseEn: CvSource = {
  persona: "tom",
  file: "nurse-en.docx",
  name: "Nurse (EN)",
  mediaType: "docx",
  lines: [
    h("Tom Okafor"),
    p("Registered Nurse – Manchester, United Kingdom"),
    p("tom.okafor@inbox.example"),
    blank,
    h("Profile"),
    p(
      "Registered nurse with six years on acute medical and surgical wards. Calm under pressure and at home in a busy team.",
    ),
    blank,
    h("Skills"),
    p(NURSE_SKILLS.join(", ")),
    blank,
    h("Experience"),
    p("2022 – today: Staff Nurse, Acute Medical Unit, Northfield Hospital"),
    p("2019 – 2022: Staff Nurse, Surgical Ward, Kersal Private Hospital"),
    blank,
    h("Education"),
    p("BSc (Hons) Adult Nursing, 2019"),
  ],
  answer: {
    language: "en",
    skills: NURSE_SKILLS,
    roleFamilies: ["Nursing"],
    seniority: "Mid-level",
    countryHints: ["GB"],
    formatHints: ["one page", "no photo"],
  },
};

export const CVS: readonly CvSource[] = [backendEn, backendDe, dataEn, nurseEn];

/** The file's bytes. */
export function cvBytes(cv: CvSource): Buffer {
  return cv.mediaType === "pdf" ? pdfDocument(cv.lines) : docxDocument(cv.lines);
}

/** The CV's tags as the app suggests them: language, role families, seniority (F2.1). */
export function cvTags(answer: CvAnswer): string[] {
  return [answer.language, ...answer.roleFamilies, answer.seniority].filter(
    (t): t is string => t !== null,
  );
}

/** The skills left after the skill check (F2.2): the answer's without the invented one. */
export function checkedSkills(cv: CvSource): string[] {
  return cv.answer.skills.filter((s) => s !== cv.inventedSkill);
}

export function cvNamed(name: string): CvSource {
  const cv = CVS.find((c) => c.name === name);
  if (!cv) throw new Error(`no CV named ${name}`);
  return cv;
}
