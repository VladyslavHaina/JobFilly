import type { Address, JobFacts, Pay, TimeZoneRange, WorkMode } from "../format.ts";
import { amount, pay, personAt, role } from "./facts.ts";
import {
  RECRUITER_FOOTER_DE,
  RECRUITER_FOOTER_EN,
  RECRUITER_FOOTER_NL,
  RECRUITER_FOOTER_PT,
} from "./footers.ts";
import type { Random } from "./random.ts";

// Recruiter outreach in English, German, Portuguese and Dutch, from agencies and in-house
// recruiters. Each mail is written from its role's facts, and the facts record exactly what the
// mail states: anything a mail leaves out stays null.

export type Lang = "en" | "de" | "pt" | "nl";

interface Org {
  name: string;
  domain: string;
  agency: boolean;
  people: readonly string[];
}

export interface RecruiterMail {
  from: Address;
  subject: string;
  body: string;
  footer: readonly string[];
  facts: JobFacts;
}

interface Location {
  city: string;
  country: string;
}

interface ContractOption {
  contract: string;
  sentence: string;
  daily: boolean;
}

interface Pack {
  orgs: readonly Org[];
  clients: readonly string[];
  titles: readonly string[];
  locations: readonly Location[];
  seniorities: readonly string[];
  contracts: readonly ContractOption[];
  languages: readonly { words: string[]; sentence: string }[];
  remote: readonly { scope: string; timeZones: TimeZoneRange | null; sentence: string }[];
  footer: readonly string[];
  openers: readonly string[];
  ctas: readonly string[];
  subjects: readonly ((title: string, where: string, org: string) => string)[];
  greeting: string;
  signoff: string;
  recruiterTitle: (agency: boolean) => string;
  lead: (org: Org, client: string | null) => string;
  wants: (lead: string, title: string, city: string | null) => string;
  mode: (mode: WorkMode, city: string | null) => string;
  yearly: (min: number, max: number) => string;
  daily: (min: number, max: number) => string;
  paySentence: (asWritten: string, daily: boolean) => string;
  seniority: (s: string) => string;
  stack: (skills: string[]) => string;
  permit: { text: string; sentence: string };
  apply: (url: string) => string;
  remoteWord: string;
}

const SKILLS = [
  "Go",
  "Python",
  "Java",
  "Kotlin",
  "PostgreSQL",
  "Kafka",
  "Kubernetes",
  "AWS",
  "gRPC",
  "Redis",
  "Terraform",
  "TypeScript",
];

/** The English article for a word: "an API Engineer", "a Backend Engineer". */
const an = (word: string) => (/^[AEIOU]/.test(word) ? "an" : "a");

const list = (items: string[], and: string) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;

const EN: Pack = {
  orgs: [
    {
      name: "Atlantic Tech Search",
      domain: "atlantictech.example",
      agency: true,
      people: ["Hannah Price", "Oliver Grant"],
    },
    {
      name: "Northbridge Talent",
      domain: "northbridge-talent.example",
      agency: true,
      people: ["Priya Nair", "Daniel Okoye"],
    },
    {
      name: "Harbour Recruitment",
      domain: "harbour-rec.example",
      agency: true,
      people: ["Chloe Martin", "Ryan Walsh"],
    },
    {
      name: "Brightwave Health",
      domain: "brightwave.example",
      agency: false,
      people: ["Emma Fischer"],
    },
    {
      name: "Copperleaf Analytics",
      domain: "copperleaf.example",
      agency: false,
      people: ["Lucas Moreau"],
    },
    {
      name: "Tidewater Systems",
      domain: "tidewater.example",
      agency: false,
      people: ["Grace Lin"],
    },
    {
      name: "Quayside Bank",
      domain: "quaysidebank.example",
      agency: false,
      people: ["Martin Hughes"],
    },
  ],
  clients: ["a Series B fintech", "Lumen Freight", "Orbitly", "Fernhill Insurance"],
  titles: [
    "Backend Engineer",
    "Backend Developer (Go)",
    "Platform Engineer",
    "Software Engineer, Payments",
    "Python Backend Developer",
    "Site Reliability Engineer",
    "Data Engineer",
    "Backend Engineer (Kotlin)",
    "API Engineer",
  ],
  locations: [
    { city: "Berlin", country: "DE" },
    { city: "Amsterdam", country: "NL" },
    { city: "Dublin", country: "IE" },
    { city: "London", country: "GB" },
    { city: "Lisbon", country: "PT" },
    { city: "Barcelona", country: "ES" },
    { city: "Munich", country: "DE" },
  ],
  seniorities: ["Senior", "Mid-level", "Lead", "Staff"],
  contracts: [
    { contract: "permanent", sentence: "It's a permanent position.", daily: false },
    {
      contract: "12-month fixed-term contract",
      sentence: "It's a 12-month fixed-term contract with a good chance of extension.",
      daily: false,
    },
    { contract: "B2B", sentence: "The engagement is B2B, invoiced monthly.", daily: true },
    { contract: "freelance", sentence: "It's a freelance engagement.", daily: true },
  ],
  languages: [
    { words: ["English"], sentence: "The team works in English." },
    { words: ["English", "German"], sentence: "You'll need English and German." },
    { words: ["English", "Spanish"], sentence: "Working languages are English and Spanish." },
  ],
  remote: [
    {
      scope: "within the EU",
      timeZones: null,
      sentence: "The role is fully remote within the EU.",
    },
    {
      scope: "between UTC+0 and UTC+3",
      timeZones: { from: "UTC+00:00", to: "UTC+03:00" },
      sentence: "The role is fully remote from anywhere between UTC+0 and UTC+3.",
    },
    {
      scope: "anywhere in Europe",
      timeZones: null,
      sentence: "The role is remote, anywhere in Europe.",
    },
  ],
  footer: RECRUITER_FOOTER_EN,
  openers: [
    "I came across your profile and think you'd be a great fit for a role I'm working on.",
    "I hope you're well! I'm reaching out about a backend opportunity that might interest you.",
    "Your experience with distributed systems caught my eye, so I wanted to get in touch.",
    "I'm helping a team that's growing quickly, and your background looks like a strong match.",
  ],
  ctas: [
    "Would you be open to a quick call this week?",
    "Let me know if you'd like to hear more.",
    "If this sounds interesting, just reply and I'll send over the full details.",
  ],
  subjects: [
    (t, w) => `${t} – ${w}`,
    (t, _w, o) => `Opportunity: ${t} at ${o}`,
    (t) => `Quick question about ${an(t)} ${t} role`,
    (t, w) => `${t} role (${w})`,
  ],
  greeting: "Hi Maria,",
  signoff: "Best,",
  recruiterTitle: (agency) => (agency ? "Senior Recruiter" : "Talent Acquisition Partner"),
  lead: (org, client) =>
    org.agency ? (client ? `My client, ${client},` : "One of my clients") : `At ${org.name}, we`,
  wants: (lead, title, city) =>
    `${lead}${lead.endsWith("we") ? " are" : " is"} looking for ${an(title)} ${title}${city ? ` in ${city}` : ""}.`,
  mode: (mode, city) =>
    mode === "hybrid"
      ? "The role is hybrid, with two days a week in the office."
      : `The role is on-site in the ${city} office.`,
  yearly: (min, max) => `€${amount(min, "en")}–${amount(max, "en")} a year`,
  daily: (min, max) => `€${min}–${max} a day`,
  paySentence: (w, daily) => (daily ? `The rate is ${w}.` : `The salary is ${w}.`),
  seniority: (s) => `This is a ${s} position.`,
  stack: (skills) => `The stack: ${list(skills, "and")}.`,
  permit: {
    text: "right to work in the EU",
    sentence: "Candidates need the right to work in the EU.",
  },
  apply: (url) => `The full description is here: ${url}`,
  remoteWord: "Remote",
};

const DE: Pack = {
  orgs: [
    {
      name: "Talentbrücke Recruiting",
      domain: "talentbruecke.example",
      agency: true,
      people: ["Jonas Weber", "Lea Hoffmann"],
    },
    {
      name: "Isar Personal",
      domain: "isar-personal.example",
      agency: true,
      people: ["Felix Schmitt", "Anna Becker"],
    },
    {
      name: "Elbwerk Software GmbH",
      domain: "elbwerk.example",
      agency: false,
      people: ["Tobias Krüger"],
    },
    {
      name: "Rheinpfad Energie AG",
      domain: "rheinpfad.example",
      agency: false,
      people: ["Miriam Wolf"],
    },
  ],
  clients: ["Spreeblick Mobility GmbH", "Hafenlicht Versicherung", "ein Münchner Scale-up"],
  titles: [
    "Backend-Entwickler (m/w/d)",
    "Backend Engineer (m/w/d)",
    "Softwareentwickler Java (m/w/d)",
    "Platform Engineer (m/w/d)",
    "Go-Entwickler (m/w/d)",
  ],
  locations: [
    { city: "Berlin", country: "DE" },
    { city: "München", country: "DE" },
    { city: "Hamburg", country: "DE" },
    { city: "Köln", country: "DE" },
    { city: "Frankfurt am Main", country: "DE" },
  ],
  seniorities: ["Senior", "Professional"],
  contracts: [
    { contract: "unbefristet", sentence: "Die Anstellung ist unbefristet.", daily: false },
    {
      contract: "befristet auf 12 Monate",
      sentence: "Der Vertrag ist zunächst befristet auf 12 Monate.",
      daily: false,
    },
    { contract: "freiberuflich", sentence: "Die Zusammenarbeit ist freiberuflich.", daily: true },
  ],
  languages: [
    { words: ["Englisch"], sentence: "Die Arbeitssprache ist Englisch." },
    { words: ["Deutsch", "Englisch"], sentence: "Sie arbeiten auf Deutsch und Englisch." },
  ],
  remote: [
    {
      scope: "innerhalb der EU",
      timeZones: null,
      sentence: "Die Stelle ist komplett remote innerhalb der EU möglich.",
    },
    {
      scope: "innerhalb Deutschlands",
      timeZones: null,
      sentence: "Die Stelle ist komplett remote innerhalb Deutschlands möglich.",
    },
  ],
  footer: RECRUITER_FOOTER_DE,
  openers: [
    "ich bin auf Ihr Profil gestoßen und hätte eine spannende Position für Sie.",
    "ich hoffe, es geht Ihnen gut! Ich melde mich wegen einer interessanten Backend-Rolle.",
    "Ihre Erfahrung mit verteilten Systemen passt sehr gut zu einer Stelle, die ich gerade besetze.",
  ],
  ctas: [
    "Hätten Sie diese Woche Zeit für ein kurzes Telefonat?",
    "Ich freue mich auf Ihre Rückmeldung.",
    "Wenn Sie Interesse haben, schicke ich Ihnen gerne die vollständige Beschreibung.",
  ],
  subjects: [
    (t, w) => `${t} in ${w}`,
    (t) => `Neue Position: ${t}`,
    (t) => `Spannende Rolle als ${t}`,
  ],
  greeting: "Hallo Frau Santos,",
  signoff: "Viele Grüße",
  recruiterTitle: (agency) => (agency ? "Senior Personalberater:in" : "Recruiting"),
  lead: (org, client) =>
    org.agency ? (client ? `Mein Kunde, ${client},` : "Ein Kunde von uns") : `Die ${org.name}`,
  wants: (lead, title, city) => `${lead} sucht eine:n ${title}${city ? ` in ${city}` : ""}.`,
  mode: (mode, city) =>
    mode === "hybrid"
      ? "Die Stelle ist hybrid – zwei Tage pro Woche im Büro."
      : `Die Arbeit findet vor Ort in ${city} statt.`,
  yearly: (min, max) => `${amount(min, "de")}–${amount(max, "de")} € brutto pro Jahr`,
  daily: (min, max) => `${min}–${max} € pro Tag`,
  paySentence: (w, daily) =>
    daily ? `Der Tagessatz liegt bei ${w}.` : `Das Gehalt liegt bei ${w}.`,
  seniority: (s) => `Gesucht wird ein ${s}-Profil.`,
  stack: (skills) => `Tech-Stack: ${list(skills, "und")}.`,
  permit: {
    text: "Arbeitserlaubnis für die EU",
    sentence: "Eine Arbeitserlaubnis für die EU ist Voraussetzung.",
  },
  apply: (url) => `Die vollständige Ausschreibung finden Sie hier: ${url}`,
  remoteWord: "remote",
};

const PT: Pack = {
  orgs: [
    {
      name: "Ribeira Recrutamento",
      domain: "ribeira-rh.example",
      agency: true,
      people: ["Joana Ferreira", "Rui Almeida"],
    },
    {
      name: "Atlântico Talent",
      domain: "atlantico-talent.example",
      agency: true,
      people: ["Catarina Lopes", "Miguel Sousa"],
    },
    {
      name: "Douro Fintech",
      domain: "dourofintech.example",
      agency: false,
      people: ["Inês Rocha"],
    },
    {
      name: "Alfama Labs",
      domain: "alfamalabs.example",
      agency: false,
      people: ["Tiago Carvalho"],
    },
  ],
  clients: ["Tejo Cloud", "uma seguradora internacional", "Mar Azul Logística"],
  titles: [
    "Engenheiro(a) de Backend",
    "Programador(a) Backend",
    "Engenheiro(a) de Software – Pagamentos",
    "Programador(a) Java",
  ],
  locations: [
    { city: "Lisboa", country: "PT" },
    { city: "Coimbra", country: "PT" },
    { city: "Braga", country: "PT" },
  ],
  seniorities: ["Sénior", "Intermédio"],
  contracts: [
    { contract: "contrato sem termo", sentence: "Oferecemos contrato sem termo.", daily: false },
    {
      contract: "contrato a termo de 12 meses",
      sentence: "Trata-se de um contrato a termo de 12 meses.",
      daily: false,
    },
    { contract: "B2B", sentence: "A colaboração é em regime B2B.", daily: true },
  ],
  languages: [
    { words: ["inglês"], sentence: "A língua de trabalho é o inglês." },
    { words: ["português", "inglês"], sentence: "Vais trabalhar em português e inglês." },
  ],
  remote: [
    {
      scope: "a partir de Portugal",
      timeZones: null,
      sentence: "A posição é totalmente remota, a partir de Portugal.",
    },
    {
      scope: "em qualquer país da UE",
      timeZones: null,
      sentence: "A posição é totalmente remota, em qualquer país da UE.",
    },
  ],
  footer: RECRUITER_FOOTER_PT,
  openers: [
    "encontrei o teu perfil e acho que serias uma ótima escolha para uma função em que estou a trabalhar.",
    "espero que estejas bem! Escrevo-te por causa de uma oportunidade na área de backend.",
    "a tua experiência com sistemas distribuídos chamou-me a atenção.",
  ],
  ctas: [
    "Terias disponibilidade para uma chamada rápida esta semana?",
    "Diz-me se tiveres interesse.",
    "Se fizer sentido para ti, envio-te a descrição completa.",
  ],
  subjects: [
    (t) => `Oportunidade: ${t}`,
    (t, w) => `${t} – ${w}`,
    (t) => `Proposta de função: ${t}`,
  ],
  greeting: "Olá Maria,",
  signoff: "Cumprimentos,",
  recruiterTitle: (agency) => (agency ? "Consultora de Recrutamento" : "Talent Acquisition"),
  lead: (org, client) =>
    org.agency
      ? client
        ? `O nosso cliente, ${client},`
        : "Um dos nossos clientes"
      : `A ${org.name}`,
  wants: (lead, title, city) =>
    `${lead} está à procura de um(a) ${title}${city ? ` em ${city}` : ""}.`,
  mode: (mode, city) =>
    mode === "hybrid"
      ? "O modelo de trabalho é híbrido, com dois dias por semana no escritório."
      : `O trabalho é presencial em ${city}.`,
  yearly: (min, max) => `${amount(min, "pt")}–${amount(max, "pt")} € brutos por ano`,
  daily: (min, max) => `${min}–${max} € por dia`,
  paySentence: (w, daily) => (daily ? `A taxa diária é de ${w}.` : `O salário é de ${w}.`),
  seniority: (s) => `Procuramos um perfil ${s}.`,
  stack: (skills) => `Stack: ${list(skills, "e")}.`,
  permit: {
    text: "autorização de trabalho na UE",
    sentence: "É necessária autorização de trabalho na UE.",
  },
  apply: (url) => `Mais detalhes aqui: ${url}`,
  remoteWord: "remoto",
};

const NL: Pack = {
  orgs: [
    {
      name: "Polder Talent",
      domain: "polder-talent.example",
      agency: true,
      people: ["Sanne Bakker", "Pieter de Vries"],
    },
    {
      name: "Grachtwerk Recruitment",
      domain: "grachtwerk.example",
      agency: true,
      people: ["Lotte Visser", "Daan Smit"],
    },
    {
      name: "Dijkstra Logistics",
      domain: "dijkstra-logistics.example",
      agency: false,
      people: ["Femke de Jong"],
    },
    {
      name: "Molenwijk Bank",
      domain: "molenwijkbank.example",
      agency: false,
      people: ["Bram Mulder"],
    },
  ],
  clients: ["Kanaalstraat Labs", "een snelgroeiende scale-up", "Zuidas Payments"],
  titles: ["Backend Developer", "Backend Engineer", "Java Developer", "Platform Engineer"],
  locations: [
    { city: "Amsterdam", country: "NL" },
    { city: "Rotterdam", country: "NL" },
    { city: "Utrecht", country: "NL" },
    { city: "Eindhoven", country: "NL" },
  ],
  seniorities: ["Senior", "Medior"],
  contracts: [
    { contract: "vast contract", sentence: "Het gaat om een vast contract.", daily: false },
    {
      contract: "tijdelijk contract van 12 maanden",
      sentence: "Het betreft een tijdelijk contract van 12 maanden.",
      daily: false,
    },
    { contract: "freelance", sentence: "Het is een freelance opdracht.", daily: true },
  ],
  languages: [
    { words: ["Engels"], sentence: "De voertaal is Engels." },
    { words: ["Nederlands", "Engels"], sentence: "Je werkt in het Nederlands en Engels." },
  ],
  remote: [
    {
      scope: "binnen Europa",
      timeZones: null,
      sentence: "De functie is volledig remote binnen Europa.",
    },
    {
      scope: "binnen Nederland",
      timeZones: null,
      sentence: "De functie is volledig remote binnen Nederland.",
    },
  ],
  footer: RECRUITER_FOOTER_NL,
  openers: [
    "ik kwam je profiel tegen en denk dat je goed past bij een functie waar ik aan werk.",
    "ik hoop dat alles goed met je gaat! Ik neem contact op over een mooie backendrol.",
    "je ervaring met gedistribueerde systemen viel me op.",
  ],
  ctas: [
    "Heb je deze week tijd voor een kort belletje?",
    "Laat je weten of je interesse hebt?",
    "Als het je aanspreekt, stuur ik je graag de volledige vacature.",
  ],
  subjects: [(t) => `Vacature: ${t}`, (t, w) => `${t} in ${w}`, (t) => `Nieuwe uitdaging: ${t}`],
  greeting: "Hoi Maria,",
  signoff: "Met vriendelijke groet,",
  recruiterTitle: (agency) => (agency ? "Recruitment Consultant" : "Corporate Recruiter"),
  lead: (org, client) =>
    org.agency
      ? client
        ? `Mijn opdrachtgever ${client}`
        : "Een van onze opdrachtgevers"
      : org.name,
  wants: (lead, title, city) => `${lead} zoekt een ${title}${city ? ` in ${city}` : ""}.`,
  mode: (mode, city) =>
    mode === "hybrid"
      ? "De functie is hybride: twee dagen per week op kantoor."
      : `Je werkt op locatie in ${city}.`,
  yearly: (min, max) => `€ ${amount(min, "nl")} – € ${amount(max, "nl")} bruto per jaar`,
  daily: (min, max) => `€ ${min} – € ${max} per dag`,
  paySentence: (w, daily) => (daily ? `Het dagtarief is ${w}.` : `Het salaris is ${w}.`),
  seniority: (s) => `We zoeken een ${s} profiel.`,
  stack: (skills) => `Tech stack: ${list(skills, "en")}.`,
  permit: {
    text: "werkvergunning voor de EU",
    sentence: "Een werkvergunning voor de EU is vereist.",
  },
  apply: (url) => `De volledige vacature: ${url}`,
  remoteWord: "remote",
};

const PACKS: Record<Lang, Pack> = { en: EN, de: DE, pt: PT, nl: NL };

/** Names a client only when it is a company name, not a description ("a Series B fintech"). */
function isNamed(client: string): boolean {
  return /^[A-Z]/.test(client);
}

/** One recruiter mail in `lang`, its facts taken from what it says. */
export function recruiterMail(rnd: Random, lang: Lang, orgName?: string): RecruiterMail {
  const p = PACKS[lang];
  const org = orgName ? (p.orgs.find((o) => o.name === orgName) as Org) : rnd.pick(p.orgs);
  const from = personAt(rnd.pick(org.people), org.domain);
  const client = org.agency && rnd.chance(0.7) ? rnd.pick(p.clients) : null;
  const title = rnd.pick(p.titles);
  const mode: WorkMode = rnd.pick(["hybrid", "hybrid", "onsite", "remote"] as const);
  const location = mode === "remote" ? null : rnd.pick(p.locations);
  const remote = mode === "remote" ? rnd.pick(p.remote) : null;
  const contract = rnd.chance(0.65) ? rnd.pick(p.contracts) : null;
  const daily = contract?.daily ?? false;
  let jobPay: Pay | null = null;
  if (rnd.chance(0.75)) {
    if (daily) {
      const min = rnd.pick([400, 450, 500, 550, 600]);
      jobPay = pay(min, min + 100, "EUR", "day", p.daily(min, min + 100));
    } else if (location?.country === "GB") {
      const min = rnd.pick([65, 70, 75, 80]) * 1000;
      const max = min + 15000;
      jobPay = pay(min, max, "GBP", "year", `£${amount(min, "en")}–${amount(max, "en")} a year`);
    } else {
      const min = rnd.pick(lang === "pt" ? [35, 40, 45, 50, 55] : [55, 60, 65, 70, 75, 80]) * 1000;
      const max = min + rnd.pick([10, 15, 20]) * 1000;
      jobPay = pay(min, max, "EUR", "year", p.yearly(min, max));
    }
  }
  const seniority = rnd.chance(0.5) ? rnd.pick(p.seniorities) : null;
  const languages = rnd.chance(0.4) ? rnd.pick(p.languages) : null;
  const skills = rnd.chance(0.8) ? rnd.sample(SKILLS, rnd.int(2, 4)) : [];
  const permit = rnd.chance(0.12);
  const applyUrl = rnd.chance(0.3)
    ? `https://careers.${org.domain}/jobs/${rnd.int(1000, 9999)}`
    : null;

  const lines = [
    p.wants(p.lead(org, client), title, location?.city ?? null),
    remote ? remote.sentence : p.mode(mode, location?.city ?? null),
  ];
  if (jobPay) lines.push(p.paySentence(jobPay.asWritten, daily));
  if (contract) lines.push(contract.sentence);
  if (seniority) lines.push(p.seniority(seniority));
  if (languages) lines.push(languages.sentence);
  if (skills.length > 0) lines.push(p.stack(skills));
  if (permit) lines.push(p.permit.sentence);
  const body = [
    p.greeting,
    rnd.pick(p.openers),
    lines.join(" "),
    ...(applyUrl ? [p.apply(applyUrl)] : []),
    rnd.pick(p.ctas),
    `${p.signoff}\n${from.name}\n${p.recruiterTitle(org.agency)}, ${org.name}`,
  ].join("\n\n");

  const where = location?.city ?? p.remoteWord;
  const facts = role({
    title,
    company: org.agency ? (client && isNamed(client) ? client : null) : org.name,
    agency: org.agency
      ? { name: org.name, client: client && isNamed(client) ? client : null }
      : null,
    places: location ? [{ country: location.country, city: location.city }] : [],
    workMode: mode,
    remoteScope: remote?.scope ?? null,
    timeZones: remote?.timeZones ?? null,
    pay: jobPay,
    contract: contract?.contract ?? null,
    seniority,
    workPermit: permit ? p.permit.text : null,
    skills,
    languages: languages?.words ?? [],
    applyUrl,
  });
  return {
    from,
    subject: rnd.pick(p.subjects)(title, where, org.name),
    body,
    footer: p.footer,
    facts,
  };
}
