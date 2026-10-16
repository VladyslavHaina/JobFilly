import {
  type Address,
  type DraftAnswer,
  type ExpectedRoleFit,
  type JobFacts,
  PERSONA_ADDRESSES,
  PERSONA_NAMES,
  type SenderVerdict,
} from "../format.ts";
import { pay, role } from "./facts.ts";
import { RECRUITER_FOOTER_DE, RECRUITER_FOOTER_EN } from "./footers.ts";
import type { Lang } from "./recruiters.ts";
import type { HardConflict, MessageSpec } from "./spec.ts";

// The mail `seed deliver <id>` brings into Maria's Inbox during an MVP 2 run (MVP-2 › Fixtures
// added), all dated within the 14-day reply window. Each message has its ground truth: the
// sender verdict, and per role the expected fit, the decisions it needs and whether it ends up
// with a draft, plus the fake AI's draft.v1 answers for the roles that get one.
//
// Her profile at that point (MVP 1 S4 removed Amsterdam): backend roles, Senior, hybrid in
// Berlin or remote in the EU, at least €70,000 a year or €450 a day, permanent or B2B.

interface DeliveryRole {
  facts: JobFacts;
  /** Its hard conflicts (F4.2), written by hand against her profile above. */
  hardConflicts: HardConflict[];
  /** Where the role's score lands: at or above the reply threshold, below it, or capped. */
  fit: ExpectedRoleFit;
  /** The decisions (group keys) the role waits on before its draft. */
  needs: string[];
  /** Whether the role ends up with an automatic draft in the run (after its decisions). */
  draft: boolean;
  /** draft.v1 answers by attempt (automatic, after a decision, or Draft a reply). */
  answers: Partial<Record<1 | 2, DraftAnswer>>;
  /** Skills the chosen CV lacks that the match.v1 answer still calls close (skill → reason). */
  closeSkills?: Readonly<Record<string, string>>;
}

export interface DeliverySource {
  /** The id `seed deliver` takes. */
  id: string;
  /**
   * The scenario step that delivers it: S2 delivers the batch, S5 the second Zurich role, S11
   * one message before a replica is killed and one after the mail server is back.
   */
  step: "S2" | "S5" | "S11";
  minutesAgo: number;
  from: Address;
  subject: string;
  body: string;
  footer: readonly string[];
  language: Lang;
  sender: SenderVerdict;
  roles: DeliveryRole[];
}

const ME: Address = { address: PERSONA_ADDRESSES.maria, name: PERSONA_NAMES.maria };

/** The Message-ID of a delivered message: <maria-deliver-<id>@sender-domain>. */
function deliveryMessageId(d: DeliverySource): string {
  return `<maria-deliver-${d.id}@${d.from.address.slice(d.from.address.indexOf("@") + 1)}>`;
}

/** A delivered message as a MessageSpec, for the .eml writer and the classify/extract answers. */
export function deliverySpec(d: DeliverySource): MessageSpec {
  return {
    messageId: deliveryMessageId(d),
    folder: "inbox",
    minutesAgo: d.minutesAgo,
    from: d.from,
    to: [ME],
    cc: [],
    replyTo: [],
    subject: d.subject,
    body: d.body,
    footer: d.footer,
    inReplyTo: null,
    references: [],
    listId: null,
    listUnsubscribe: null,
    precedence: null,
    language: d.language,
    stageOne: "likely_job",
    category: "recruiter_outreach",
    facts: d.roles.map((r) => r.facts),
    preferences: null,
    invalid: false,
    hardConflicts: d.roles.map((r) => r.hardConflicts),
  };
}

const reply = (
  subject: string,
  body: string,
  language: Lang,
  usedEntries: string[],
  extra: Partial<DraftAnswer> = {},
): DraftAnswer => ({
  subject: `Re: ${subject}`,
  body,
  language,
  usedEntries,
  attachCv: false,
  questions: [],
  ...extra,
});

/** A role a hard conflict caps (F4.2), with no draft. */
const capped = (hardConflicts: HardConflict[], facts: JobFacts): DeliveryRole => ({
  facts,
  hardConflicts,
  fit: "capped",
  needs: [],
  draft: false,
  answers: {},
});

const BERLIN_SUBJECT = "Senior Backend-Entwicklerin (m/w/d) bei Kiezwerk – Berlin, hybrid";
const REMOTE_SUBJECT = "Senior Backend Engineer – remote within the EU";
const APAC_SUBJECT = "Senior Backend Engineer – remote, Singapore hours";
const DATA_SUBJECT = "Data Engineer – remote in the EU";
const ZURICH_SUBJECT = "Senior Backend Engineer – remote, team in Zurich";
const BASEL_SUBJECT = "Senior Backend-Entwickler (m/w/d) – remote, Team in Basel";
const DUBLIN_SUBJECT = "Senior Backend Engineer – remote-first, office in Dublin";
const ZURICH2_SUBJECT = "Backend Engineer (Go) – remote, Zurich";

/** The group key of the CHF pay question (groupKeyFor("min_pay", ["CHF", "year"])). */
const CHF_PAY_GROUP = "min_pay:CHF:year";
/** The group key of the Dublin relocation question, the extra entry its answer writes. */
const RELOCATION_GROUP = "extra.relocation-ireland";

export const DELIVERIES: readonly DeliverySource[] = [
  {
    id: "berlin-de",
    step: "S2",
    minutesAgo: 95,
    from: { address: "lena.hoffmann@kiezwerk.example", name: "Lena Hoffmann" },
    subject: BERLIN_SUBJECT,
    body: "Hallo Frau Santos,\n\nich leite das Recruiting bei der Kiezwerk Software GmbH in Berlin. Für unser Payments-Team suchen wir eine Senior Backend-Entwicklerin (m/w/d). Die Stelle ist hybrid: zwei Tage pro Woche arbeiten Sie in unserem Büro in Berlin-Kreuzberg. Das Gehalt liegt bei 80.000–90.000 € brutto pro Jahr. Unser Stack: Go, PostgreSQL, Kubernetes und Redis.\n\nWenn Sie Interesse haben, schicken Sie mir bitte Ihren Lebenslauf, dann melde ich mich mit einem Terminvorschlag.\n\nViele Grüße\nLena Hoffmann\nRecruiting, Kiezwerk Software GmbH",
    footer: RECRUITER_FOOTER_DE,
    language: "de",
    sender: "looks_fine",
    roles: [
      {
        facts: role({
          title: "Senior Backend-Entwicklerin (m/w/d)",
          company: "Kiezwerk Software GmbH",
          places: [{ country: "DE", city: "Berlin" }],
          workMode: "hybrid",
          pay: pay(80000, 90000, "EUR", "year", "80.000–90.000 € brutto pro Jahr"),
          seniority: "Senior",
          skills: ["Go", "PostgreSQL", "Kubernetes", "Redis"],
        }),
        hardConflicts: [],
        fit: "good",
        needs: [],
        draft: true,
        // Redis is in no CV and not in the profile. The model calls it close; the scorer must
        // still show it as missing and never count it as a fit (F4.4, S3).
        closeSkills: {
          Redis: "Redis is a data store, close to the PostgreSQL in the CV",
        },
        answers: {
          1: reply(
            BERLIN_SUBJECT,
            "Hallo Frau Hoffmann,\n\nvielen Dank für Ihre Nachricht. Die Stelle als Senior Backend-Entwicklerin in Berlin, hybrid, passt sehr gut zu dem, was ich suche: Ich arbeite seit Jahren mit Go, PostgreSQL und Kubernetes, und das Gehalt liegt in meinem Rahmen.\n\nMeinen Lebenslauf habe ich angehängt. Ich freue mich auf Ihren Terminvorschlag.\n\nViele Grüße\nMaria Santos",
            "de",
            ["target_roles", "seniority", "places", "min_pay"],
            { attachCv: true },
          ),
        },
      },
    ],
  },
  {
    id: "remote-eu",
    step: "S2",
    minutesAgo: 140,
    from: { address: "ingrid.berg@fjordline.example", name: "Ingrid Berg" },
    subject: REMOTE_SUBJECT,
    body: "Hi Maria,\n\nI'm the technical recruiter at Fjordline Analytics. We're hiring a Senior Backend Engineer for our streaming team. The role is fully remote within the EU, with core hours of 10:00–16:00 CET (UTC+1, UTC+2 in summer). The salary is €85,000–95,000 a year on a permanent contract, and the team works in English. We use Go, Kafka and PostgreSQL.\n\nWould you be up for a first call next week?\n\nBest,\nIngrid Berg\nTechnical Recruiter, Fjordline Analytics",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      {
        facts: role({
          title: "Senior Backend Engineer",
          company: "Fjordline Analytics",
          workMode: "remote",
          remoteScope: "within the EU",
          timeZones: { from: "UTC+01:00", to: "UTC+02:00" },
          pay: pay(85000, 95000, "EUR", "year", "€85,000–95,000 a year"),
          contract: "permanent",
          seniority: "Senior",
          skills: ["Go", "Kafka", "PostgreSQL"],
          languages: ["English"],
        }),
        hardConflicts: [],
        fit: "good",
        needs: [],
        draft: true,
        answers: {
          // The first attempt keeps a template placeholder, so it is rejected and drafted again
          // (F6.2, S4).
          1: reply(
            REMOTE_SUBJECT,
            "Hi [Name],\n\nThank you for reaching out. A remote Senior Backend Engineer role within the EU on CET hours is exactly what I'm looking for, and I work with Go, Kafka and PostgreSQL every day.\n\nA call next week works for me.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "seniority", "remote", "min_pay"],
          ),
          2: reply(
            REMOTE_SUBJECT,
            "Hi Ingrid,\n\nThank you for reaching out. A remote Senior Backend Engineer role within the EU on CET hours is exactly what I'm looking for, and I work with Go, Kafka and PostgreSQL every day.\n\nA call next week works for me.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "seniority", "remote", "min_pay"],
          ),
        },
      },
    ],
  },
  {
    id: "amsterdam",
    step: "S2",
    minutesAgo: 210,
    from: { address: "bram.devries@grachtenbank.example", name: "Bram de Vries" },
    subject: "Backend Engineer – hybrid in Amsterdam",
    body: "Hi Maria,\n\nGrachten Bank is looking for a Backend Engineer for its payments platform. The role is hybrid, three days a week in our Amsterdam office, with a salary of €80,000–90,000 a year on a permanent contract. We build in Go.\n\nShall we schedule a short call?\n\nKind regards,\nBram de Vries\nCorporate Recruiter, Grachten Bank",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      capped(
        // Hybrid in Amsterdam, which she removed from her places in MVP 1 S4.
        ["places"],
        role({
          title: "Backend Engineer",
          company: "Grachten Bank",
          places: [{ country: "NL", city: "Amsterdam" }],
          workMode: "hybrid",
          pay: pay(80000, 90000, "EUR", "year", "€80,000–90,000 a year"),
          contract: "permanent",
          skills: ["Go"],
        }),
      ),
    ],
  },
  {
    id: "singapore",
    step: "S2",
    minutesAgo: 260,
    from: { address: "weiling.tan@merlion-pay.example", name: "Wei Ling Tan" },
    subject: "Senior Backend Engineer – onsite in Singapore",
    body: "Hi Maria,\n\nMerlion Pay is growing its engineering team in Singapore and I'd love to tell you about our Senior Backend Engineer opening. The role is onsite in our Singapore office, five days a week, and we help with relocation. The stack is Go and PostgreSQL.\n\nAre you open to a move to Singapore?\n\nWarm regards,\nWei Ling Tan\nTalent Partner, Merlion Pay",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      capped(
        // Onsite: she takes onsite work nowhere.
        ["places"],
        role({
          title: "Senior Backend Engineer",
          company: "Merlion Pay",
          places: [{ country: "SG", city: "Singapore" }],
          workMode: "onsite",
          seniority: "Senior",
          skills: ["Go", "PostgreSQL"],
        }),
      ),
    ],
  },
  {
    id: "apac-1",
    step: "S2",
    minutesAgo: 320,
    from: { address: "aditi.rao@lanterncommerce.example", name: "Aditi Rao" },
    subject: APAC_SUBJECT,
    body: "Hi Maria,\n\nLantern Commerce is hiring a Senior Backend Engineer. You can work fully remote from anywhere, but the team keeps Singapore hours, 09:00–18:00 UTC+8. The salary is €80,000–95,000 a year on a permanent contract. Our services are written in Go on PostgreSQL and run on Kubernetes.\n\nCould we talk this week?\n\nBest,\nAditi Rao\nEngineering Recruiter, Lantern Commerce",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      {
        facts: role({
          title: "Senior Backend Engineer",
          company: "Lantern Commerce",
          workMode: "remote",
          remoteScope: "from anywhere",
          timeZones: { from: "UTC+08:00", to: "UTC+08:00" },
          pay: pay(80000, 95000, "EUR", "year", "€80,000–95,000 a year"),
          contract: "permanent",
          seniority: "Senior",
          skills: ["Go", "PostgreSQL", "Kubernetes"],
        }),
        hardConflicts: [],
        fit: "good",
        needs: [],
        draft: true,
        answers: {
          1: reply(
            APAC_SUBJECT,
            "Hi Aditi,\n\nThank you for getting in touch. The Senior Backend Engineer role sounds interesting: Go, PostgreSQL and Kubernetes are what I work with, and a permanent remote role suits me.\n\nI'd be glad to talk this week.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "seniority", "remote", "min_pay"],
          ),
        },
      },
    ],
  },
  {
    id: "apac-2",
    step: "S2",
    minutesAgo: 380,
    from: { address: "jasmine.cruz@harborline.example", name: "Jasmine Cruz" },
    subject: "Backend Developer – remote, UTC+8",
    body: "Hi Maria,\n\nHarborline Logistics in Manila is looking for a Backend Developer to join remotely from anywhere. You'd work Manila hours, UTC+8. For engineers based in Europe we pay €50,000–60,000 a year. We use Go and Redis.\n\nInterested?\n\nRegards,\nJasmine Cruz\nRecruitment Lead, Harborline Logistics",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      capped(
        // Remote, but €60,000 at the top is below her €70,000 a year.
        ["min_pay"],
        role({
          title: "Backend Developer",
          company: "Harborline Logistics",
          workMode: "remote",
          remoteScope: "from anywhere",
          timeZones: { from: "UTC+08:00", to: "UTC+08:00" },
          pay: pay(50000, 60000, "EUR", "year", "€50,000–60,000 a year"),
          skills: ["Go", "Redis"],
        }),
      ),
    ],
  },
  {
    id: "apac-3",
    step: "S2",
    minutesAgo: 450,
    from: { address: "liam.walsh@wattledata.example", name: "Liam Walsh" },
    subject: "Backend Engineer – remote on Sydney hours",
    body: "Hi Maria,\n\nWattle Data is hiring a Backend Engineer to work remotely on Sydney hours, UTC+10. Contractors outside Australia are paid in euros, €55,000–65,000 a year. The platform is Kotlin and PostgreSQL.\n\nLet me know if you'd like the details.\n\nCheers,\nLiam Walsh\nTalent Acquisition, Wattle Data",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      capped(
        // Remote, but €65,000 at the top is below her €70,000 a year.
        ["min_pay"],
        role({
          title: "Backend Engineer",
          company: "Wattle Data",
          workMode: "remote",
          timeZones: { from: "UTC+10:00", to: "UTC+10:00" },
          pay: pay(55000, 65000, "EUR", "year", "€55,000–65,000 a year"),
          skills: ["Kotlin", "PostgreSQL"],
        }),
      ),
    ],
  },
  {
    id: "data-eng",
    step: "S2",
    minutesAgo: 520,
    from: { address: "oskar.lindqvist@nordkap-data.example", name: "Oskar Lindqvist" },
    subject: DATA_SUBJECT,
    body: "Hi Maria,\n\nNordkap Data is looking for a Data Engineer to build our reporting pipelines. The role is fully remote within the EU and pays €60,000–65,000 a year. You'd work with Python, SQL, Apache Airflow and dbt.\n\nWould you like to hear more?\n\nBest wishes,\nOskar Lindqvist\nPeople Team, Nordkap Data",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      {
        ...capped(
          // Remote in the EU, but €65,000 at the top is below her €70,000 a year.
          ["min_pay"],
          role({
            title: "Data Engineer",
            company: "Nordkap Data",
            workMode: "remote",
            remoteScope: "within the EU",
            pay: pay(60000, 65000, "EUR", "year", "€60,000–65,000 a year"),
            skills: ["Python", "SQL", "Apache Airflow", "dbt"],
          }),
        ),
        // Below the threshold, so only Draft a reply drafts it (S4), with "Data engineering (EN)".
        answers: {
          1: reply(
            DATA_SUBJECT,
            "Hi Oskar,\n\nThank you for your message. I've built reporting pipelines in Python and SQL, scheduled with Apache Airflow and modelled with dbt, so the role caught my eye.\n\nI'd be happy to hear more about the team.\n\nBest regards,\nMaria Santos",
            "en",
            ["remote"],
          ),
        },
      },
    ],
  },
  {
    id: "zurich",
    step: "S2",
    minutesAgo: 600,
    from: { address: "nina.keller@limmatledger.example", name: "Nina Keller" },
    subject: ZURICH_SUBJECT,
    body: "Hi Maria,\n\nLimmat Ledger AG is hiring a Senior Backend Engineer. Our team sits in Zurich, but the role is fully remote within the EU and Switzerland, on a permanent contract. The salary is CHF 120,000–135,000 a year. We build in Go on PostgreSQL.\n\nWhat would your salary expectation be in CHF?\n\nBest regards,\nNina Keller\nTalent Acquisition, Limmat Ledger AG",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      {
        facts: role({
          title: "Senior Backend Engineer",
          company: "Limmat Ledger AG",
          workMode: "remote",
          remoteScope: "within the EU and Switzerland",
          pay: pay(120000, 135000, "CHF", "year", "CHF 120,000–135,000 a year"),
          contract: "permanent",
          seniority: "Senior",
          skills: ["Go", "PostgreSQL"],
          extra: { office: "Zurich" },
        }),
        hardConflicts: [],
        fit: "good",
        needs: [CHF_PAY_GROUP],
        draft: true,
        answers: {
          1: reply(
            ZURICH_SUBJECT,
            "Hi Nina,\n\nThank you for reaching out. A remote Senior Backend Engineer role working in Go on PostgreSQL fits what I'm looking for, and the salary range you mention in CHF works for me.\n\nI'd be glad to set up a call.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "seniority", "remote", "min_pay"],
          ),
        },
      },
    ],
  },
  {
    id: "basel",
    step: "S2",
    minutesAgo: 680,
    from: { address: "jan.meier@rheinknie.example", name: "Jan Meier" },
    subject: BASEL_SUBJECT,
    body: "Hallo Frau Santos,\n\ndie Rheinknie Health AG sucht eine:n Senior Backend-Entwickler (m/w/d). Unser Team sitzt in Basel, die Stelle ist aber vollständig remote innerhalb der EU und der Schweiz, unbefristet. Das Gehalt liegt bei CHF 115.000–135.000 pro Jahr. Wir arbeiten mit Go und Kubernetes.\n\nWas sind Ihre Gehaltsvorstellungen in CHF?\n\nFreundliche Grüße\nJan Meier\nHR Business Partner, Rheinknie Health AG",
    footer: RECRUITER_FOOTER_DE,
    language: "de",
    sender: "looks_fine",
    roles: [
      {
        facts: role({
          title: "Senior Backend-Entwickler (m/w/d)",
          company: "Rheinknie Health AG",
          workMode: "remote",
          remoteScope: "innerhalb der EU und der Schweiz",
          // Its top equals the Zurich role's: whichever of the two opens the CHF decision, every
          // amount it suggests keeps all three CHF roles at or above the new minimum (S5).
          pay: pay(115000, 135000, "CHF", "year", "CHF 115.000–135.000 pro Jahr"),
          contract: "unbefristet",
          seniority: "Senior",
          skills: ["Go", "Kubernetes"],
          extra: { office: "Basel" },
        }),
        hardConflicts: [],
        fit: "good",
        needs: [CHF_PAY_GROUP],
        draft: true,
        answers: {
          1: reply(
            BASEL_SUBJECT,
            "Hallo Herr Meier,\n\nvielen Dank für Ihre Nachricht. Eine Remote-Stelle als Senior Backend-Entwicklerin mit Go und Kubernetes passt sehr gut zu mir, und die genannte Gehaltsspanne in CHF entspricht meinen Vorstellungen.\n\nIch freue mich auf ein erstes Gespräch.\n\nViele Grüße\nMaria Santos",
            "de",
            ["target_roles", "seniority", "remote", "min_pay"],
          ),
        },
      },
    ],
  },
  {
    id: "dublin",
    step: "S2",
    minutesAgo: 760,
    from: { address: "aoife.byrne@liffeylabs.example", name: "Aoife Byrne" },
    subject: DUBLIN_SUBJECT,
    body: "Hi Maria,\n\nLiffey Labs is remote-first, with an office in Dublin. We're hiring a Senior Backend Engineer, fully remote within the EU, at €85,000–100,000 a year on a permanent contract. Our backend is Go and PostgreSQL.\n\nOne question up front: would you consider relocating to Dublin at a later stage?\n\nAll the best,\nAoife Byrne\nHead of Talent, Liffey Labs",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      {
        facts: role({
          title: "Senior Backend Engineer",
          company: "Liffey Labs",
          workMode: "remote",
          remoteScope: "within the EU",
          pay: pay(85000, 100000, "EUR", "year", "€85,000–100,000 a year"),
          contract: "permanent",
          seniority: "Senior",
          skills: ["Go", "PostgreSQL"],
          extra: { office: "Dublin" },
        }),
        hardConflicts: [],
        fit: "good",
        needs: [RELOCATION_GROUP],
        // S5 closes the relocation decision with "Don't ask for this message": no draft.
        draft: false,
        answers: {
          1: reply(
            DUBLIN_SUBJECT,
            "Hi Aoife,\n\nThank you for reaching out. A remote Senior Backend Engineer role in Go and PostgreSQL fits what I'm looking for.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "seniority", "remote"],
            {
              questions: [
                {
                  profileKey: RELOCATION_GROUP,
                  groupKey: RELOCATION_GROUP,
                  question: "Would you relocate to Ireland?",
                  // The model says which answers turn the question down (draft.v1).
                  choices: [
                    { label: "Yes", declines: false },
                    { label: "No", declines: true },
                    { label: "Maybe later", declines: true },
                  ],
                },
              ],
            },
          ),
        },
      },
    ],
  },
  {
    id: "zurich-2",
    step: "S5",
    minutesAgo: 45,
    from: { address: "marco.bernasconi@uetliberg.example", name: "Marco Bernasconi" },
    subject: ZURICH2_SUBJECT,
    body: "Hi Maria,\n\nUetliberg Systems AG is hiring a Backend Engineer for our Go platform. The team is in Zurich and the role is fully remote within the EU and Switzerland, permanent, at CHF 125,000–140,000 a year.\n\nWhat would your salary expectation be?\n\nKind regards,\nMarco Bernasconi\nRecruiting, Uetliberg Systems AG",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      {
        facts: role({
          title: "Backend Engineer (Go)",
          company: "Uetliberg Systems AG",
          workMode: "remote",
          remoteScope: "within the EU and Switzerland",
          pay: pay(125000, 140000, "CHF", "year", "CHF 125,000–140,000 a year"),
          contract: "permanent",
          skills: ["Go"],
          extra: { office: "Zurich" },
        }),
        hardConflicts: [],
        fit: "good",
        // Delivered after the CHF question is answered: it uses that answer (F7.6).
        needs: [],
        draft: true,
        answers: {
          1: reply(
            ZURICH2_SUBJECT,
            "Hi Marco,\n\nThank you for your message. A remote Backend Engineer role on a Go platform fits what I'm looking for, and the salary range you mention in CHF works for me.\n\nI'd be happy to talk.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "remote", "min_pay"],
          ),
        },
      },
    ],
  },
  {
    id: "scam",
    step: "S2",
    minutesAgo: 840,
    from: { address: "hiring.desk@quickhire-global.example", name: "QuickHire Global Hiring Desk" },
    subject: "Remote Data Entry Assistant – start today, no interview",
    body: "Dear Applicant,\n\nYou have been selected for the position of Remote Data Entry Assistant with QuickHire Global. No interview is required and you can start today.\n\nTo activate your account, pay the one-time registration fee of €95 and reply with a copy of your passport (both pages) within 12 hours. Your first assignment will follow as soon as both are received.\n\nRegards,\nHiring Desk\nQuickHire Global",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "high_risk",
    roles: [
      {
        facts: role({
          title: "Remote Data Entry Assistant",
          company: "QuickHire Global",
          workMode: "remote",
        }),
        hardConflicts: [],
        fit: "below",
        needs: [],
        draft: false,
        answers: {},
      },
    ],
  },
  {
    id: "freemail",
    step: "S2",
    minutesAgo: 900,
    from: {
      address: "hanseatic.freight.recruiting.e2e@gmail.com",
      name: "Hanseatic Freight Group Talent Team",
    },
    subject: "Backend Engineer at Hanseatic Freight Group – Hamburg",
    body: "Hello Maria,\n\nI recruit for Hanseatic Freight Group, one of Europe's largest freight forwarders. We are hiring a Backend Engineer for our Hamburg headquarters, onsite five days a week, at €75,000–85,000 a year. The team uses Java and PostgreSQL.\n\nPlease reply to this address if you are interested.\n\nRegards,\nTalent Team\nHanseatic Freight Group",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "caution",
    roles: [
      capped(
        // Onsite in Hamburg: she takes onsite work nowhere.
        ["places"],
        role({
          title: "Backend Engineer",
          company: "Hanseatic Freight Group",
          places: [{ country: "DE", city: "Hamburg" }],
          workMode: "onsite",
          pay: pay(75000, 85000, "EUR", "year", "€75,000–85,000 a year"),
          skills: ["Java", "PostgreSQL"],
        }),
      ),
    ],
  },
  // S11 (resilience) delivers these two one at a time, by id: one before a replica is killed,
  // one after `docker compose unpause imap` to show new mail flows again. Both are plain onsite
  // roles a hard conflict caps, like the Singapore one: no draft, no decision, nothing beyond
  // the classify, extract and match answers every delivery has.
  {
    id: "s11-failover",
    step: "S11",
    minutesAgo: 10,
    from: { address: "sophie.wagner@isarwerk.example", name: "Sophie Wagner" },
    subject: "Backend Engineer – onsite in Munich",
    body: "Hi Maria,\n\nIsarwerk Mobility is hiring a Backend Engineer for its routing team. The role is onsite in our Munich office, five days a week, at €75,000–85,000 a year on a permanent contract. We build in Go on PostgreSQL.\n\nWould you be interested in a short call?\n\nBest regards,\nSophie Wagner\nTalent Acquisition, Isarwerk Mobility",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      capped(
        // Onsite in Munich: she takes onsite work nowhere.
        ["places"],
        role({
          title: "Backend Engineer",
          company: "Isarwerk Mobility",
          places: [{ country: "DE", city: "Munich" }],
          workMode: "onsite",
          pay: pay(75000, 85000, "EUR", "year", "€75,000–85,000 a year"),
          contract: "permanent",
          skills: ["Go", "PostgreSQL"],
        }),
      ),
    ],
  },
  {
    id: "s11-recovery",
    step: "S11",
    minutesAgo: 5,
    from: { address: "lukas.gruber@donaukanal.example", name: "Lukas Gruber" },
    subject: "Backend Engineer – onsite in Vienna",
    body: "Hi Maria,\n\nDonaukanal Software is looking for a Backend Engineer to join our team in Vienna. The role is onsite, four days a week in the office, at €70,000–80,000 a year on a permanent contract. Our services are written in Go.\n\nLet me know if you'd like to hear more.\n\nKind regards,\nLukas Gruber\nRecruiting, Donaukanal Software",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      capped(
        // Onsite in Vienna: she takes onsite work nowhere.
        ["places"],
        role({
          title: "Backend Engineer",
          company: "Donaukanal Software",
          places: [{ country: "AT", city: "Vienna" }],
          workMode: "onsite",
          pay: pay(70000, 80000, "EUR", "year", "€70,000–80,000 a year"),
          contract: "permanent",
          skills: ["Go"],
        }),
      ),
    ],
  },
];
