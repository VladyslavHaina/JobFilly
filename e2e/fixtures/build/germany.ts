import type { Preferences } from "../format.ts";
import { MARIA_PROFILES } from "../format-mvp3.ts";
import type { DeliverySource } from "./deliveries.ts";
import { capped, reply } from "./delivery-kit.ts";
import { pay, role } from "./facts.ts";
import { RECRUITER_FOOTER_DE, RECRUITER_FOOTER_EN } from "./footers.ts";

// MVP 3 S1, "Maria moves to Germany" (MVP-3 › Fixtures added): `seed deliver S1` brings German
// mail about hybrid roles in München and Hamburg, paid yearly in EUR on permanent contracts, while
// her remote EU mail keeps arriving, and appends to her Sent folder two replies saying she has
// moved and wants permanent roles in Germany. The re-run of setup reads those replies into the
// "Germany permanent" profile; F1.4 then sends the München and Hamburg roles to it and leaves the
// remote EU roles with "My job search".
//
// Against the profile MVP 2 starts with (deliveries.ts), the German roles are capped by their
// place (hybrid outside Berlin) and get no draft; the remote roles fit and get one. Every role
// still has draft.v1 answers: once a role moves to "Germany permanent" it fits there, and the app
// may draft it again after a reassignment (S2), so the fake AI must never be left without one.
// The cities are as the German mail writes them ("München"), and so are her replies' places.

const GERMANY = MARIA_PROFILES.germany;
const FIRST = MARIA_PROFILES.first;

const MUNICH_1_SUBJECT = "Senior Backend-Entwicklerin (m/w/d) – München, hybrid";
const MUNICH_2_SUBJECT = "Senior Backend Engineer (m/w/d) für einen Versicherer in München";
const HAMBURG_1_SUBJECT = "Senior Backend-Entwickler (m/w/d) – Hamburg, hybrid";
const HAMBURG_2_SUBJECT = "Backend Engineer (m/w/d) im Hamburger Hafen – hybrid";
const REMOTE_2_SUBJECT = "Senior Backend Engineer – fully remote in the EU";
const REMOTE_3_SUBJECT = "Backend Engineer (Go) – remote within the EU";

/** A German draft for a role in Germany: what "Germany permanent" drafts once it's assigned. */
const germanDraft = (subject: string, greeting: string, why: string) => ({
  1: reply(
    subject,
    `${greeting},\n\nvielen Dank für Ihre Nachricht. ${why} Ich wohne inzwischen in Deutschland und suche genau so eine unbefristete Stelle.\n\nIch freue mich auf ein erstes Gespräch.\n\nViele Grüße\nMaria Santos`,
    "de",
    ["target_roles", "seniority", "places", "contracts", "min_pay"],
  ),
  2: reply(
    subject,
    `${greeting},\n\nherzlichen Dank für die Nachricht. ${why} Seit meinem Umzug nach Deutschland suche ich eine unbefristete Stelle wie diese.\n\nGerne vereinbare ich einen Termin mit Ihnen.\n\nViele Grüße\nMaria Santos`,
    "de",
    ["target_roles", "seniority", "places", "contracts", "min_pay"],
  ),
});

export const GERMANY_DELIVERIES: readonly DeliverySource[] = [
  {
    id: "munich-1",
    step: "S1",
    minutesAgo: 600,
    from: { address: "katrin.vogel@isarblick.example", name: "Katrin Vogel" },
    subject: MUNICH_1_SUBJECT,
    body: "Hallo Frau Santos,\n\nich bin Recruiterin bei der Isarblick Technologies GmbH in München. Für unser Plattform-Team suchen wir eine Senior Backend-Entwicklerin (m/w/d). Die Stelle ist hybrid: zwei Tage pro Woche arbeiten Sie in unserem Büro in München-Schwabing. Wir bieten eine unbefristete Festanstellung mit 82.000–92.000 € brutto pro Jahr. Die Arbeitssprache ist Deutsch. Unser Stack: Go, PostgreSQL, Kubernetes und gRPC.\n\nHätten Sie Zeit für ein erstes Gespräch?\n\nViele Grüße\nKatrin Vogel\nRecruiting, Isarblick Technologies GmbH",
    footer: RECRUITER_FOOTER_DE,
    language: "de",
    sender: "looks_fine",
    roles: [
      {
        ...capped(
          // Hybrid in München, outside Berlin, the one place she takes hybrid work in MVP 2.
          ["places"],
          role({
            title: "Senior Backend-Entwicklerin (m/w/d)",
            company: "Isarblick Technologies GmbH",
            places: [{ country: "DE", city: "München" }],
            workMode: "hybrid",
            pay: pay(82000, 92000, "EUR", "year", "82.000–92.000 € brutto pro Jahr"),
            contract: "unbefristet",
            seniority: "Senior",
            skills: ["Go", "PostgreSQL", "Kubernetes", "gRPC"],
            languages: ["Deutsch"],
          }),
        ),
        profile: GERMANY,
        answers: germanDraft(
          MUNICH_1_SUBJECT,
          "Hallo Frau Vogel",
          "Die Stelle als Senior Backend-Entwicklerin in München, hybrid, passt sehr gut zu mir: Ich arbeite seit Jahren mit Go, PostgreSQL, Kubernetes und gRPC.",
        ),
      },
    ],
  },
  {
    id: "munich-2",
    step: "S1",
    minutesAgo: 900,
    from: { address: "florian.huber@bergwerk-personal.example", name: "Florian Huber" },
    subject: MUNICH_2_SUBJECT,
    body: "Hallo Frau Santos,\n\nich bin Personalberater bei Bergwerk Personalberatung. Mein Kunde, die Würmtal Versicherung AG, sucht eine:n Senior Backend Engineer (m/w/d) in München. Die Stelle ist hybrid mit drei Bürotagen pro Woche, unbefristet, und das Gehalt liegt bei 78.000–88.000 € brutto pro Jahr. Das Team arbeitet mit Go, Kafka und PostgreSQL.\n\nPasst das zu Ihren Plänen?\n\nBeste Grüße\nFlorian Huber\nBergwerk Personalberatung",
    footer: RECRUITER_FOOTER_DE,
    language: "de",
    sender: "looks_fine",
    roles: [
      {
        ...capped(
          // Hybrid in München, outside Berlin.
          ["places"],
          role({
            title: "Senior Backend Engineer (m/w/d)",
            company: "Würmtal Versicherung AG",
            agency: { name: "Bergwerk Personalberatung", client: "Würmtal Versicherung AG" },
            places: [{ country: "DE", city: "München" }],
            workMode: "hybrid",
            pay: pay(78000, 88000, "EUR", "year", "78.000–88.000 € brutto pro Jahr"),
            contract: "unbefristet",
            seniority: "Senior",
            skills: ["Go", "Kafka", "PostgreSQL"],
          }),
        ),
        profile: GERMANY,
        answers: germanDraft(
          MUNICH_2_SUBJECT,
          "Hallo Herr Huber",
          "Die Stelle als Senior Backend Engineer in München mit Go, Kafka und PostgreSQL klingt sehr passend.",
        ),
      },
    ],
  },
  {
    id: "hamburg-1",
    step: "S1",
    minutesAgo: 1200,
    from: { address: "jana.petersen@alsterkontor.example", name: "Jana Petersen" },
    subject: HAMBURG_1_SUBJECT,
    body: "Moin Frau Santos,\n\ndie Alsterkontor Logistik GmbH sucht für ihr Tracking-Team eine:n Senior Backend-Entwickler (m/w/d) in Hamburg. Sie arbeiten hybrid, drei Tage pro Woche in unserem Büro an der Binnenalster. Die Stelle ist unbefristet und mit 80.000–90.000 € brutto pro Jahr vergütet. Wir setzen auf Go, Kafka, PostgreSQL und Docker.\n\nWann passt Ihnen ein kurzes Telefonat?\n\nViele Grüße\nJana Petersen\nPeople & Culture, Alsterkontor Logistik GmbH",
    footer: RECRUITER_FOOTER_DE,
    language: "de",
    sender: "looks_fine",
    roles: [
      {
        ...capped(
          // Hybrid in Hamburg, outside Berlin.
          ["places"],
          role({
            title: "Senior Backend-Entwickler (m/w/d)",
            company: "Alsterkontor Logistik GmbH",
            places: [{ country: "DE", city: "Hamburg" }],
            workMode: "hybrid",
            pay: pay(80000, 90000, "EUR", "year", "80.000–90.000 € brutto pro Jahr"),
            contract: "unbefristet",
            seniority: "Senior",
            skills: ["Go", "Kafka", "PostgreSQL", "Docker"],
          }),
        ),
        profile: GERMANY,
        answers: germanDraft(
          HAMBURG_1_SUBJECT,
          "Hallo Frau Petersen",
          "Die Stelle als Senior Backend-Entwicklerin in Hamburg, hybrid, passt sehr gut: Go, Kafka, PostgreSQL und Docker sind mein Alltag.",
        ),
      },
    ],
  },
  {
    id: "hamburg-2",
    step: "S1",
    minutesAgo: 1500,
    from: { address: "ole.hansen@kaispeicher.example", name: "Ole Hansen" },
    subject: HAMBURG_2_SUBJECT,
    body: "Hallo Frau Santos,\n\nbei der Kaispeicher Terminal GmbH bauen wir die Software, die Container durch den Hamburger Hafen bewegt. Wir suchen eine:n Backend Engineer (m/w/d), hybrid in Hamburg, unbefristet, für 76.000–86.000 € brutto pro Jahr. Bei uns arbeiten Sie mit Go, gRPC und PostgreSQL.\n\nHaben Sie Interesse?\n\nViele Grüße\nOle Hansen\nTeamlead Backend, Kaispeicher Terminal GmbH",
    footer: RECRUITER_FOOTER_DE,
    language: "de",
    sender: "looks_fine",
    roles: [
      {
        ...capped(
          // Hybrid in Hamburg, outside Berlin.
          ["places"],
          role({
            title: "Backend Engineer (m/w/d)",
            company: "Kaispeicher Terminal GmbH",
            places: [{ country: "DE", city: "Hamburg" }],
            workMode: "hybrid",
            pay: pay(76000, 86000, "EUR", "year", "76.000–86.000 € brutto pro Jahr"),
            contract: "unbefristet",
            skills: ["Go", "gRPC", "PostgreSQL"],
          }),
        ),
        profile: GERMANY,
        answers: germanDraft(
          HAMBURG_2_SUBJECT,
          "Hallo Herr Hansen",
          "Software für den Hamburger Hafen mit Go, gRPC und PostgreSQL klingt spannend.",
        ),
      },
    ],
  },
  {
    id: "remote-eu-2",
    step: "S1",
    minutesAgo: 400,
    from: { address: "marta.kowalska@vistula-cloud.example", name: "Marta Kowalska" },
    subject: REMOTE_2_SUBJECT,
    body: "Hi Maria,\n\nI lead recruiting at Vistula Cloud. We're hiring a Senior Backend Engineer for our billing platform. The role is fully remote within the EU, on CET hours (UTC+1, UTC+2 in summer), with a salary of €88,000–98,000 a year on a permanent contract. The team works in English with Go, Kafka and PostgreSQL.\n\nWould you have time for a call this week?\n\nBest,\nMarta Kowalska\nHead of Talent, Vistula Cloud",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      {
        facts: role({
          title: "Senior Backend Engineer",
          company: "Vistula Cloud",
          workMode: "remote",
          remoteScope: "within the EU",
          timeZones: { from: "UTC+01:00", to: "UTC+02:00" },
          pay: pay(88000, 98000, "EUR", "year", "€88,000–98,000 a year"),
          contract: "permanent",
          seniority: "Senior",
          skills: ["Go", "Kafka", "PostgreSQL"],
          languages: ["English"],
        }),
        hardConflicts: [],
        fit: "good",
        needs: [],
        draft: true,
        profile: FIRST,
        answers: {
          1: reply(
            REMOTE_2_SUBJECT,
            "Hi Marta,\n\nThank you for reaching out. A fully remote Senior Backend Engineer role within the EU on CET hours fits what I'm looking for, and Go, Kafka and PostgreSQL are what I work with every day.\n\nA call this week works for me.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "seniority", "remote", "min_pay"],
          ),
          2: reply(
            REMOTE_2_SUBJECT,
            "Hi Marta,\n\nThanks for your message. The remote Senior Backend Engineer role sounds like a good fit: I build services in Go, Kafka and PostgreSQL.\n\nI'd be glad to talk this week.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "seniority", "remote", "min_pay"],
          ),
        },
      },
    ],
  },
  {
    id: "remote-eu-3",
    step: "S1",
    minutesAgo: 800,
    from: { address: "pieter.claes@scheldt-data.example", name: "Pieter Claes" },
    subject: REMOTE_3_SUBJECT,
    body: "Hi Maria,\n\nScheldt Data is looking for a Backend Engineer to work on our ingestion services in Go. The role is remote within the EU and permanent, paying €80,000–90,000 a year. We use gRPC, PostgreSQL and Kubernetes.\n\nInterested in hearing more?\n\nKind regards,\nPieter Claes\nRecruiter, Scheldt Data",
    footer: RECRUITER_FOOTER_EN,
    language: "en",
    sender: "looks_fine",
    roles: [
      {
        facts: role({
          title: "Backend Engineer (Go)",
          company: "Scheldt Data",
          workMode: "remote",
          remoteScope: "within the EU",
          pay: pay(80000, 90000, "EUR", "year", "€80,000–90,000 a year"),
          contract: "permanent",
          skills: ["Go", "gRPC", "PostgreSQL", "Kubernetes"],
        }),
        hardConflicts: [],
        fit: "good",
        needs: [],
        draft: true,
        profile: FIRST,
        answers: {
          1: reply(
            REMOTE_3_SUBJECT,
            "Hi Pieter,\n\nThank you for your message. A remote Backend Engineer role within the EU, working in Go with gRPC, PostgreSQL and Kubernetes, is right up my street.\n\nI'd be happy to hear more.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "remote", "min_pay"],
          ),
          2: reply(
            REMOTE_3_SUBJECT,
            "Hi Pieter,\n\nThanks for getting in touch. Ingestion services in Go on gRPC, PostgreSQL and Kubernetes are what I enjoy building, and a remote role within the EU suits me.\n\nI'd be happy to hear more.\n\nBest regards,\nMaria Santos",
            "en",
            ["target_roles", "remote", "min_pay"],
          ),
        },
      },
    ],
  },
];

/** One of Maria's replies `seed deliver S1` appends to Sent, answering a delivery of the batch. */
export interface SentDeliverySource {
  id: string;
  step: "S1";
  minutesAgo: number;
  /** The delivery it answers (In-Reply-To). */
  inReplyTo: string;
  /** Her words; the generator quotes the mail she answers below them. */
  text: string;
  /** What the reply states: the prefs.v1 answer. */
  preferences: Preferences;
}

/** Her places in Germany, worded as the German mail and her replies write them. */
const MUNICH = { country: "DE", city: "München", mode: "hybrid" } as const;
const HAMBURG = { country: "DE", city: "Hamburg", mode: "hybrid" } as const;

export const GERMANY_REPLIES: readonly SentDeliverySource[] = [
  {
    id: "moved-hamburg",
    step: "S1",
    minutesAgo: 1380,
    inReplyTo: "hamburg-2",
    text: "Hi Ole,\n\nThanks for your message, and sorry for answering in English. Some news first: I've moved to Germany, so I'm now looking for permanent roles in Germany only. Here is what I'm after now:\n\n- Roles: Backend Engineer\n- Seniority: Senior\n- Location: hybrid in Hamburg or München\n- Contract: permanent\n- Pay: at least €75,000 a year\n- Languages: English and German\n- Work permit: I'm an EU citizen, so I can work in Germany without one\n\nIf that fits the role, I'd be glad to talk.\n\nBest regards,\nMaria",
    preferences: {
      target_roles: ["Backend Engineer"],
      seniority: ["Senior"],
      places: [HAMBURG, MUNICH],
      contracts: ["permanent"],
      min_pay: [{ amount: 75000, currency: "EUR", period: "year", asWritten: "€75,000 a year" }],
      languages: ["English", "German"],
      work_permits: [{ country: null, text: "EU citizen" }],
    },
  },
  {
    id: "moved-munich",
    step: "S1",
    minutesAgo: 840,
    inReplyTo: "munich-2",
    text: "Hallo Herr Huber,\n\nvielen Dank für Ihre Nachricht. Ich bin vor Kurzem nach Deutschland gezogen und suche jetzt eine unbefristete Festanstellung, hybrid in München oder Hamburg. Mein Gehaltswunsch liegt bei mindestens 75.000 € brutto im Jahr.\n\nWenn das für Ihren Kunden passt, sprechen wir gerne.\n\nViele Grüße\nMaria Santos",
    preferences: {
      places: [MUNICH, HAMBURG],
      contracts: ["unbefristet"],
      min_pay: [
        { amount: 75000, currency: "EUR", period: "year", asWritten: "75.000 € brutto im Jahr" },
      ],
    },
  },
];
