import type { Address, JobFacts, Pay, WorkMode } from "../format.ts";
import { amount, pay, role } from "./facts.ts";
import { ALERT_FOOTER } from "./footers.ts";
import type { Random } from "./random.ts";
import type { Lang } from "./recruiters.ts";

// Job-board alerts for Maria: each lists one to four roles. They come only from the boards' alert
// addresses, carry List-Unsubscribe like real alerts, and stage one sorts them as job_alert.

interface Board {
  from: Address;
  lang: Lang;
  query: string;
  subject: (n: number, q: string) => string;
  intro: (n: number, q: string) => string;
  link: (id: number) => string;
  unsubscribe: (id: number) => string;
}

export const BOARDS: readonly Board[] = [
  {
    from: { address: "jobalerts-noreply@linkedin.com", name: "LinkedIn Job Alerts" },
    lang: "en",
    query: "backend engineer",
    subject: (n, q) => `${n} new ${n === 1 ? "job" : "jobs"} for "${q}"`,
    intro: (n, q) =>
      `Your job alert for "${q}" in European Union: ${n} new ${n === 1 ? "job" : "jobs"}.`,
    link: (id) => `https://www.linkedin.com/jobs/view/${id}`,
    unsubscribe: (id) => `<https://www.linkedin.com/comm/jobs/alerts/unsubscribe?alertId=${id}>`,
  },
  {
    from: { address: "alert@indeed.com", name: "Indeed" },
    lang: "en",
    query: "backend developer",
    subject: (n, q) => `${n} new ${q} ${n === 1 ? "job" : "jobs"}`,
    intro: (n, q) =>
      `Here ${n === 1 ? "is" : "are"} ${n} new ${q} ${n === 1 ? "job" : "jobs"} for you.`,
    link: (id) => `https://www.indeed.com/viewjob?jk=${id.toString(16)}`,
    unsubscribe: (id) => `<https://www.indeed.com/alert/unsubscribe?id=${id.toString(16)}>`,
  },
  {
    from: { address: "jobagent@stepstone.de", name: "StepStone Jobagent" },
    lang: "de",
    query: "Backend",
    subject: (n, q) => `Ihr Jobagent: ${n} neue Jobs für "${q}"`,
    intro: (n, q) => `Ihr Jobagent "${q}" hat ${n} neue passende Stellenangebote gefunden.`,
    link: (id) => `https://www.stepstone.de/stellenangebote--${id}-inline.html`,
    unsubscribe: (id) => `<https://www.stepstone.de/jobagent/abmelden?id=${id}>`,
  },
  {
    from: { address: "jobs@xing.com", name: "XING Jobs" },
    lang: "de",
    query: "Softwareentwicklung",
    subject: (n) => `${n} neue Stellenangebote für Sie`,
    intro: (n, q) => `Wir haben ${n} neue Jobs im Bereich ${q} für Sie gefunden.`,
    link: (id) => `https://www.xing.com/jobs/${id}`,
    unsubscribe: (id) => `<https://www.xing.com/settings/notifications/unsubscribe?t=${id}>`,
  },
  {
    from: { address: "alertas@net-empregos.com", name: "Net-Empregos" },
    lang: "pt",
    query: "programador backend",
    subject: (n, q) => `Alerta de emprego: ${n} novas ofertas de "${q}"`,
    intro: (n, q) => `Encontrámos ${n} novas ofertas para o seu alerta "${q}".`,
    link: (id) => `https://www.net-empregos.com/${id}/oferta/`,
    unsubscribe: (id) => `<https://www.net-empregos.com/alertas/cancelar?id=${id}>`,
  },
  {
    from: { address: "vacaturemail@nationalevacaturebank.nl", name: "Nationale Vacaturebank" },
    lang: "nl",
    query: "backend developer",
    subject: (n, q) => `${n} nieuwe vacatures voor "${q}"`,
    intro: (n, q) => `Er zijn ${n} nieuwe vacatures die passen bij je zoekopdracht "${q}".`,
    link: (id) => `https://www.nationalevacaturebank.nl/vacature/${id}`,
    unsubscribe: (id) => `<https://www.nationalevacaturebank.nl/vacaturemail/afmelden?id=${id}>`,
  },
];

const TITLES: Record<Lang, readonly string[]> = {
  en: [
    "Senior Backend Engineer",
    "Backend Developer",
    "Software Engineer – Backend",
    "Go Developer",
    "Platform Engineer",
    "Backend Engineer (Java)",
    "Staff Software Engineer",
  ],
  de: [
    "Backend-Entwickler (m/w/d)",
    "Senior Backend Engineer (m/w/d)",
    "Softwareentwickler Backend (m/w/d)",
    "Cloud Engineer (m/w/d)",
  ],
  pt: ["Programador Backend (m/f)", "Engenheiro de Software Backend", "Backend Developer"],
  nl: ["Backend Developer", "Software Engineer Backend", "Senior Java Developer"],
};

const COMPANIES = [
  "Nordlicht Payments",
  "Elbwerk Software GmbH",
  "Tejo Cloud",
  "Copperleaf Analytics",
  "Brightwave Health",
  "Douro Fintech",
  "Zuidas Payments",
  "Spreeblick Mobility GmbH",
  "Lumen Freight",
  "Orbitly",
  "Molenwijk Bank",
  "Alfama Labs",
  "Rheinpfad Energie AG",
];

const PLACES: Record<Lang, readonly { city: string; country: string; name: string }[]> = {
  en: [
    { city: "Berlin", country: "DE", name: "Germany" },
    { city: "Amsterdam", country: "NL", name: "Netherlands" },
    { city: "Dublin", country: "IE", name: "Ireland" },
    { city: "Lisbon", country: "PT", name: "Portugal" },
    { city: "Madrid", country: "ES", name: "Spain" },
  ],
  de: [
    { city: "Berlin", country: "DE", name: "Deutschland" },
    { city: "Hamburg", country: "DE", name: "Deutschland" },
    { city: "München", country: "DE", name: "Deutschland" },
    { city: "Wien", country: "AT", name: "Österreich" },
  ],
  pt: [
    { city: "Lisboa", country: "PT", name: "Portugal" },
    { city: "Porto", country: "PT", name: "Portugal" },
    { city: "Aveiro", country: "PT", name: "Portugal" },
  ],
  nl: [
    { city: "Amsterdam", country: "NL", name: "Nederland" },
    { city: "Utrecht", country: "NL", name: "Nederland" },
    { city: "Den Haag", country: "NL", name: "Nederland" },
  ],
};

const MODE_WORDS: Record<Lang, Record<WorkMode, string>> = {
  en: { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" },
  de: { remote: "Remote", hybrid: "Hybrid", onsite: "Vor Ort" },
  pt: { remote: "Remoto", hybrid: "Híbrido", onsite: "Presencial" },
  nl: { remote: "Remote", hybrid: "Hybride", onsite: "Op locatie" },
};

const APPLY: Record<Lang, string> = {
  en: "View job",
  de: "Zur Stelle",
  pt: "Ver oferta",
  nl: "Bekijk vacature",
};

function alertPay(rnd: Random, lang: Lang): Pay {
  if (lang === "nl") {
    const min = rnd.pick([4500, 5000, 5500]);
    return pay(
      min,
      min + 1000,
      "EUR",
      "month",
      `€ ${amount(min, "nl")} – € ${amount(min + 1000, "nl")} per maand`,
    );
  }
  const min = rnd.pick(lang === "pt" ? [35, 40, 45, 50] : [60, 65, 70, 75, 80]) * 1000;
  const max = min + 15000;
  const asWritten =
    lang === "en"
      ? `€${amount(min, "en")}–${amount(max, "en")} a year`
      : lang === "de"
        ? `${amount(min, "de")}–${amount(max, "de")} € pro Jahr`
        : `${amount(min, "pt")}–${amount(max, "pt")} € por ano`;
  return pay(min, max, "EUR", "year", asWritten);
}

export interface AlertRole {
  title: string;
  company: string;
  place: { city: string; country: string; name: string } | null;
  mode: WorkMode | null;
  pay: Pay | null;
}

/** An alert's roles, chosen at random; `count` of them. */
export function randomRoles(rnd: Random, lang: Lang, count: number): AlertRole[] {
  return rnd.sample(TITLES[lang], Math.min(count, TITLES[lang].length)).map((title) => {
    const remote = rnd.chance(0.2);
    return {
      title,
      company: rnd.pick(COMPANIES),
      place: remote ? null : rnd.pick(PLACES[lang]),
      mode: remote ? "remote" : rnd.chance(0.6) ? rnd.pick(["hybrid", "onsite"] as const) : null,
      pay: rnd.chance(0.4) ? alertPay(rnd, lang) : null,
    };
  });
}

export interface AlertMail {
  from: Address;
  subject: string;
  body: string;
  footer: readonly string[];
  listUnsubscribe: string;
  facts: JobFacts[];
}

/** One alert from `board` listing `roles`. */
export function alertMail(rnd: Random, board: Board, roles: AlertRole[]): AlertMail {
  const alertId = rnd.int(100000, 999999);
  const blocks: string[] = [];
  const facts = roles.map((r) => {
    const url = board.link(rnd.int(3_000_000_000, 3_999_999_999));
    const where = [
      r.place ? `${r.place.city}, ${r.place.name}` : null,
      r.mode ? MODE_WORDS[board.lang][r.mode] : null,
    ].filter(Boolean);
    blocks.push(
      [
        r.title,
        `${r.company}${where.length > 0 ? ` · ${where.join(" · ")}` : ""}`,
        ...(r.pay ? [r.pay.asWritten] : []),
        `${APPLY[board.lang]}: ${url}`,
      ].join("\n"),
    );
    const senior = /^(Senior|Staff)\b/.exec(r.title)?.[1] ?? null;
    return role({
      title: r.title,
      company: r.company,
      places: r.place ? [{ country: r.place.country, city: r.place.city }] : [],
      workMode: r.mode,
      pay: r.pay,
      seniority: senior,
      applyUrl: url,
    });
  });
  return {
    from: board.from,
    subject: board.subject(roles.length, board.query),
    body: [board.intro(roles.length, board.query), ...blocks].join("\n\n"),
    footer: ALERT_FOOTER,
    listUnsubscribe: board.unsubscribe(alertId),
    facts,
  };
}
