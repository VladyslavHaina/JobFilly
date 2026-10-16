import {
  type Address,
  type AppliedMark,
  type Category,
  LOOKUP_FAILED_SIGNAL,
  MESSAGE_GONE_SIGNAL,
  type MessageSignal,
  type MxLookupResult,
  type RdapLookupResult,
  type SenderCheck,
  type SenderReason,
  type SenderVerdict,
} from "@jobfilly/schema";
import { fold, languageName, wordIndices, words } from "../cv/text";
import { loadFreeMailDomains, loadLanguageWords, loadMessageSignals } from "./data";
import { tokens } from "./language";

// The sender check (F5): signals from the message (asks for a fee, for ID documents before an
// offer, hiring over chat only, a free-mail address for a company recruiter, a sender that
// doesn't match the company) and from the domain (its age from RDAP, its MX records), each with
// a reason worded as an estimate, aggregated into looks fine, caution or high risk. Anything that
// couldn't be checked makes the check incomplete, never "looks fine" (F5.3); an editor's trusted
// or blocked mark overrides the verdict and is named first (F5.4).

/** The sender's domain (lower case), or null for an address without one. */
export function senderDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  const domain =
    at < 0
      ? ""
      : address
          .slice(at + 1)
          .trim()
          .toLowerCase();
  return domain.includes(".") ? domain : null;
}

/** Whether the domain is a free-mail provider's (data/free-mail-domains.json). */
export function isFreeMailDomain(domain: string): boolean {
  return loadFreeMailDomains().domains.includes(domain.toLowerCase());
}

/** What the domain lookups found: an answer, "failed", or null when not looked up. */
export interface DomainFacts {
  rdap: RdapLookupResult | "failed" | null;
  mx: MxLookupResult | "failed" | null;
}

export interface SenderCheckInput {
  from: Address;
  category: Category | null;
  /** The companies and agencies the message's roles name. */
  companies: readonly string[];
  /** The body's text; null when the message is gone from the mailbox. */
  text: string | null;
  /** The body's language (ISO 639-1) as detected, or null. */
  language: string | null;
  domain: DomainFacts;
  /** The mark that applies to the sender, by its address or its whole domain. */
  mark: AppliedMark | null;
  now: Date;
}

/** A domain registered less than this many days ago is young. */
const YOUNG_DOMAIN_DAYS = 180;

/** How much a signal weighs: one strong sign makes high risk; three medium ones do too. */
const STRONG = new Set(["asks_for_fee", "asks_for_id"]);
const MEDIUM = new Set([
  "chat_only",
  "free_mail_company",
  "sender_mismatch",
  "young_domain",
  "no_mx",
]);
const MEDIUM_FOR_HIGH_RISK = 3;

/** Message categories where the sender writes as a company's recruiter. */
const RECRUITER_CATEGORIES: ReadonlySet<Category> = new Set(["recruiter_outreach"]);

/** How many words before a phrase are searched for a negation ("never pay a fee"). */
const NEGATION_WINDOW = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

let negations: Set<string> | null = null;
function allNegations(): Set<string> {
  negations ??= new Set(Object.values(loadLanguageWords().languages).flatMap((l) => l.negations));
  return negations;
}

/** The first phrase of `phrases` the text says without a negation just before it. */
function firstPhrase(text: string, phrases: readonly string[]): string | null {
  const negated = allNegations();
  for (const phrase of phrases) {
    for (const at of wordIndices(text, fold(phrase))) {
      const before = tokens(text.slice(Math.max(0, at - 80), at)).slice(-NEGATION_WINDOW);
      if (!before.some((w) => negated.has(w))) return phrase;
    }
  }
  return null;
}

const MESSAGE_REASON: Record<MessageSignal, (phrase: string) => string> = {
  asks_for_fee: (p) =>
    `Probably a scam sign: asks for a fee ("${p}"); real employers rarely charge candidates`,
  asks_for_id: (p) =>
    `Probably a scam sign: asks for a passport scan or ID documents before an offer ("${p}")`,
  chat_only: (p) => `Possibly risky: wants to hire over chat only ("${p}")`,
};

/** Signals in the text, from every language's phrase lists (a message may mix languages). */
function messageSignals(text: string): SenderReason[] {
  const folded = fold(text);
  const lists = Object.values(loadMessageSignals().languages);
  const out: SenderReason[] = [];
  for (const signal of ["asks_for_fee", "asks_for_id", "chat_only"] as const) {
    for (const list of lists) {
      const phrase = firstPhrase(folded, list[signal]);
      if (phrase) {
        out.push({ signal, reason: MESSAGE_REASON[signal](phrase) });
        break;
      }
    }
  }
  return out;
}

/** The compact labels of a domain without its top-level label ("mail.acme-corp.example" → mail, acmecorp). */
function domainLabels(domain: string): string[] {
  return domain
    .split(".")
    .slice(0, -1)
    .map((l) => l.replace(/[^a-z0-9]/g, ""))
    .filter((l) => l.length > 0);
}

/**
 * Whether a company's name shows in the domain, leniently: one of its words (four letters or
 * more, or its first five) appears in a label, or a label of four or more appears in the name
 * ("Talentbrücke Recruiting" ↔ talentbruecke, "Harbour Recruitment" ↔ harbour-rec).
 */
export function nameMatchesDomain(name: string, domain: string): boolean {
  const labels = domainLabels(domain);
  const nameWords = words(name);
  const compactName = nameWords.join("");
  for (const word of nameWords) {
    if (word.length < 4) continue;
    const key = word.slice(0, 5);
    if (labels.some((l) => l.includes(key))) return true;
  }
  return labels.some((l) => l.length >= 4 && compactName.includes(l));
}

function companySignals(
  domain: string | null,
  category: Category | null,
  companies: readonly string[],
): SenderReason[] {
  if (!domain || !category || !RECRUITER_CATEGORIES.has(category)) return [];
  const names = [...new Set(companies.map((c) => c.trim()).filter(Boolean))];
  const named = names[0];
  if (!named) return [];
  if (isFreeMailDomain(domain)) {
    return [
      {
        signal: "free_mail_company",
        reason: `Possibly not from ${named}: writes as a company recruiter from a free-mail address (${domain})`,
      },
    ];
  }
  if (names.some((n) => nameMatchesDomain(n, domain))) return [];
  return [
    {
      signal: "sender_mismatch",
      reason: `Possibly not from ${named}: the sender's domain ${domain} doesn't seem to belong to it`,
    },
  ];
}

function domainSignals(domain: string, facts: DomainFacts, now: Date): SenderReason[] {
  const out: SenderReason[] = [];
  if (facts.rdap === "failed") {
    out.push({
      signal: LOOKUP_FAILED_SIGNAL,
      reason: `Couldn't look up when ${domain} was registered, so this check is incomplete`,
    });
  } else if (facts.rdap?.registeredAt) {
    const days = Math.floor((now.getTime() - Date.parse(facts.rdap.registeredAt)) / DAY_MS);
    if (Number.isFinite(days) && days < YOUNG_DOMAIN_DAYS) {
      out.push({
        signal: "young_domain",
        reason: `Possibly risky: the domain ${domain} seems to be only ${Math.max(days, 0)} days old`,
      });
    }
  }
  if (facts.mx === "failed") {
    out.push({
      signal: LOOKUP_FAILED_SIGNAL,
      reason: `Couldn't look up the mail servers of ${domain}, so this check is incomplete`,
    });
  } else if (facts.mx && facts.mx.length === 0) {
    out.push({
      signal: "no_mx",
      reason: `Possibly risky: the domain ${domain} seems to have no mail servers`,
    });
  }
  return out;
}

/** What couldn't be checked: these make the check incomplete. */
const INCOMPLETE = new Set([
  LOOKUP_FAILED_SIGNAL,
  "language_not_checked",
  "no_domain",
  MESSAGE_GONE_SIGNAL,
]);

function aggregate(reasons: readonly SenderReason[], complete: boolean): SenderVerdict {
  const strong = reasons.filter((r) => STRONG.has(r.signal)).length;
  const medium = reasons.filter((r) => MEDIUM.has(r.signal)).length;
  if (strong > 0 || medium >= MEDIUM_FOR_HIGH_RISK) return "high_risk";
  if (medium > 0 || !complete) return "caution";
  return "looks_fine";
}

/**
 * ID documents are a normal part of a genuine offer, so an ID request in a message categorised as
 * an offer is set aside, but only when nothing else is wrong. The category is the model's guess,
 * and a scam that poses as an offer (F5.5: "we are pleased to offer you the position", then a fee
 * and a passport scan) must keep its ID reason: with any other strong or medium sign present, the
 * request counts.
 */
function withoutOfferIdRequest(
  reasons: readonly SenderReason[],
  category: Category | null,
): SenderReason[] {
  if (category !== "offer") return [...reasons];
  const otherSign = reasons.some(
    (r) => r.signal !== "asks_for_id" && (STRONG.has(r.signal) || MEDIUM.has(r.signal)),
  );
  return otherSign ? [...reasons] : reasons.filter((r) => r.signal !== "asks_for_id");
}

/** Strong signs first, then medium ones, then what couldn't be checked. */
function bySeverity(reasons: readonly SenderReason[]): SenderReason[] {
  const rank = (r: SenderReason) => (STRONG.has(r.signal) ? 0 : MEDIUM.has(r.signal) ? 1 : 2);
  return [...reasons].sort((a, b) => rank(a) - rank(b));
}

const markedWhat = (m: AppliedMark) =>
  m.scope === "domain" ? `the domain ${m.value}` : `the address ${m.value}`;

/**
 * The check of one sender for one message. Every reason is worded as an estimate. A mark decides
 * the verdict (trusted: looks fine, blocked: high risk) and comes first; the signals found are
 * still listed after it.
 */
export function checkSender(input: SenderCheckInput): SenderCheck {
  let reasons: SenderReason[] = [];
  const domain = senderDomain(input.from.address);

  if (input.text === null) {
    reasons.push({
      signal: MESSAGE_GONE_SIGNAL,
      reason: "The message is no longer in the mailbox, so its text couldn't be checked",
    });
  } else {
    reasons.push(...messageSignals(input.text));
    const lists = input.language ? loadMessageSignals().languages[input.language] : undefined;
    if (!lists) {
      const name = languageName(input.language);
      reasons.push({
        signal: "language_not_checked",
        reason: name
          ? `Can't read ${name} text for warning signs yet, so this check is incomplete`
          : "Couldn't tell the message's language to read it for warning signs, so this check is incomplete",
      });
    }
  }
  reasons.push(...companySignals(domain, input.category, input.companies));

  if (input.mark) {
    const signs = bySeverity(
      withoutOfferIdRequest(reasons, input.category).filter((r) => !INCOMPLETE.has(r.signal)),
    );
    const aside = signs.length > 0 ? ", so the signs below are set aside" : "";
    const mark: SenderReason =
      input.mark.mark === "trusted"
        ? {
            signal: "marked_trusted",
            reason: `Trusted: ${markedWhat(input.mark)} is marked trusted in this workspace${aside}`,
          }
        : {
            signal: "marked_blocked",
            reason: `Blocked: ${markedWhat(input.mark)} is marked blocked in this workspace`,
          };
    return {
      verdict: input.mark.mark === "trusted" ? "looks_fine" : "high_risk",
      // The verdict is the editor's, not the lookups': nothing is left to check.
      complete: true,
      reasons: [mark, ...signs],
      mark: input.mark.mark,
    };
  }

  if (domain) reasons.push(...domainSignals(domain, input.domain, input.now));
  else {
    reasons.push({
      signal: "no_domain",
      reason: "Couldn't tell the sender's domain, so this check is incomplete",
    });
  }
  reasons = withoutOfferIdRequest(reasons, input.category);
  const complete = !reasons.some((r) => INCOMPLETE.has(r.signal));
  const verdict = aggregate(reasons, complete);
  if (reasons.length === 0) {
    reasons.push({
      signal: "no_warning_signs",
      reason: "Looks fine as far as we can tell: no warning signs in the text or the domain",
    });
  }
  return { verdict, complete, reasons: bySeverity(reasons), mark: null };
}
