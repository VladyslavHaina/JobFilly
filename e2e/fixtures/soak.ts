import { composeText } from "./build/build.ts";
import { buildEml, toHtml } from "./build/eml.ts";
import { pay, role } from "./build/facts.ts";
import { RECRUITER_FOOTER_EN } from "./build/footers.ts";
import type { MessageSpec } from "./build/spec.ts";
import {
  type Address,
  type ClassifyAnswer,
  type DraftAnswer,
  type ExtractAnswer,
  type JobFacts,
  type MatchAnswer,
  PERSONA_ADDRESSES,
  PERSONA_NAMES,
  type Persona,
} from "./format.ts";

// The soak's generated job mail (F10.3): `seed generate --per-minute N`
// appends N messages a minute to each persona's Inbox, and the fake AI answers them from these
// templates by their Message-ID, <soak-<persona>-<run>-<n>@sender-domain>, rather than from a
// fixture file. Every message is a recruiter's onsite role from a sender domain the test stack's
// RDAP and DNS data already know, so the sender check finds it; Maria's is in München onsite,
// which none of her profiles takes, so it is capped and never drafted; Tom's may be drafted, and
// the template has the draft.

interface Template {
  from: Address;
  subject: (n: number) => string;
  body: (n: number) => string;
  facts: JobFacts;
  draft: (subject: string) => DraftAnswer;
}

const TEMPLATES: Record<Persona, Template> = {
  maria: {
    from: { address: "sophie.wagner@isarwerk.example", name: "Sophie Wagner" },
    subject: (n) => `Backend Engineer – onsite in Munich (opening ${n})`,
    body: (n) =>
      `Hi Maria,\n\nIsarwerk Mobility is hiring another Backend Engineer for its routing team, opening ${n} this quarter. The role is onsite in our Munich office, five days a week, at €75,000–85,000 a year on a permanent contract. We build in Go on PostgreSQL.\n\nWould you be interested in a short call?\n\nBest regards,\nSophie Wagner\nTalent Acquisition, Isarwerk Mobility`,
    facts: role({
      title: "Backend Engineer",
      company: "Isarwerk Mobility",
      places: [{ country: "DE", city: "Munich" }],
      workMode: "onsite",
      pay: pay(75000, 85000, "EUR", "year", "€75,000–85,000 a year"),
      contract: "permanent",
      skills: ["Go", "PostgreSQL"],
    }),
    draft: (subject) => ({
      subject: `Re: ${subject}`,
      body: "Hi Sophie,\n\nThank you for thinking of me. I'm looking for hybrid roles, so an onsite one isn't right for me, but please keep me in mind.\n\nBest regards,\nMaria Santos",
      language: "en",
      usedEntries: ["places"],
      attachCv: false,
      questions: [],
    }),
  },
  tom: {
    from: { address: "nadia.ellis@carelinknursing.example", name: "Nadia Ellis" },
    subject: (n) => `Agency shifts in Manchester (list ${n})`,
    body: (n) =>
      `Hi Tom,\n\nCarelink Nursing has new agency shifts for registered general nurses on acute wards in Manchester this week (list ${n}). The shifts are onsite, days or nights, at £32 an hour.\n\nLet me know which ones you'd like and I'll book them in.\n\nThanks,\nNadia Ellis\nShift Coordinator, Carelink Nursing`,
    facts: role({
      title: "Registered General Nurse (agency shifts)",
      company: "Carelink Nursing",
      places: [{ country: "GB", city: "Manchester" }],
      workMode: "onsite",
      pay: pay(32, 32, "GBP", "hour", "£32 an hour"),
      skills: [],
    }),
    draft: (subject) => ({
      subject: `Re: ${subject}`,
      body: "Hi Nadia,\n\nThanks for the list. I'd be glad to take some of these shifts; could you send me the dates that are still open?\n\nBest wishes,\nTom Okafor",
      language: "en",
      usedEntries: [],
      attachCv: false,
      questions: [],
    }),
  },
};

const SOAK_ID = /^<soak-(maria|tom)-[a-z0-9]+-(\d+)@[^>]+>$/;

const domainOf = (address: string) => address.slice(address.indexOf("@") + 1);

/** The Message-ID of the `n`th generated message of `run` for a persona. */
export function soakMessageId(persona: Persona, run: string, n: number): string {
  return `<soak-${persona}-${run}-${n}@${domainOf(TEMPLATES[persona].from.address)}>`;
}

/** The generated message as the seed appends it: RFC 5322 text dated `date`. */
export function soakMessage(persona: Persona, run: string, n: number, date: Date): Buffer {
  const t = TEMPLATES[persona];
  const messageId = soakMessageId(persona, run, n);
  const spec = {
    messageId,
    body: t.body(n),
    footer: RECRUITER_FOOTER_EN,
  } as Pick<MessageSpec, "messageId" | "body" | "footer"> as MessageSpec;
  const text = composeText(spec, `BODYSENTINEL-soak-${persona}-${run}-${n}`);
  return Buffer.from(
    buildEml({
      messageId,
      date,
      from: t.from,
      to: [{ address: PERSONA_ADDRESSES[persona], name: PERSONA_NAMES[persona] }],
      cc: [],
      replyTo: [],
      subject: t.subject(n),
      inReplyTo: null,
      references: [],
      listId: null,
      listUnsubscribe: null,
      precedence: null,
      text,
      html: toHtml(text),
      boundary: `=_jf_soak_${persona}_${n}`,
    }),
    "utf8",
  );
}

/** The fake AI's answers for a generated message, or null when the id is none of the soak's. */
export function soakAnswers(messageId: string): {
  classify: ClassifyAnswer;
  extract: ExtractAnswer;
  match: MatchAnswer;
  draft: DraftAnswer;
} | null {
  const found = SOAK_ID.exec(messageId);
  if (!found) return null;
  const t = TEMPLATES[found[1] as Persona];
  return {
    classify: { category: "recruiter_outreach" },
    extract: { roles: [t.facts] },
    match: {
      titleFit: { verdict: "fits", reason: `"${t.facts.title}" is the kind of role you look for` },
      skillCloseness: t.facts.skills.map((skill) => ({
        skill,
        verdict: "fits" as const,
        reason: `${skill} is in your CV`,
      })),
    },
    draft: t.draft(t.subject(Number(found[2]))),
  };
}
