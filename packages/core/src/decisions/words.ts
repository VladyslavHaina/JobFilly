import { CountryCodeSchema, type PayPeriodSchema } from "@jobfilly/schema";

// Reading the words of a decision's answer (F7.4) for what they say about the fields a group
// key's parts name: a yes or a no, an ISO country or currency code, a pay period, a work mode.
// Only what is written is read; when the words are unclear, the caller refuses the answer
// rather than guess. The yes and no words cover common European languages, as the questions are
// asked in the language of the mail; anything else is simply not read as a yes or a no.

/** The words of an answer, lower case, with "on-site" and "on site" as one word. */
export function tokensOf(text: string): string[] {
  const folded = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\bon[\s-]+site\b/g, "onsite");
  return folded.match(/[\p{L}\p{N}'’]+/gu) ?? [];
}

const words = (list: string) => new Set(list.split(" "));

/** A no when one of the first two words: "No, only Cork", "I'm not", "Nein". */
const NO_FIRST = words("no nope nah not never non nein nicht nee nej nei niet nie não nao ne");
/** A no wherever it is: "None", "I have none". */
const NO_ANYWHERE = words(
  "none nothing neither keine keinen kein keins nichts aucun aucune rien ninguno ninguna nada nessuno nessuna niente nenhum nenhuma geen ingen inget",
);
/** A yes said on its own: "Yes", "Sure", "Ja", "Oui". */
const YES = words(
  "yes yeah yep yup sure ok okay absolutely definitely certainly of course fine ja jawohl klar gerne genau oui bien sûr si sí sim tak jo",
);

/** Whether the words turn the question down. When in doubt it is a no, so nothing is written. */
export function isNo(text: string): boolean {
  const all = tokensOf(text);
  const no = (t: string | undefined) => t !== undefined && (NO_FIRST.has(t) || /n['’]t$/.test(t));
  // The first word, or the second after a short one ("I'm not", "Je ne", "Ich nicht"); a no
  // later on is part of the answer ("Stamp 4, no restrictions").
  const [first, second] = all;
  if (no(first) || (first !== undefined && first.length <= 3 && no(second))) return true;
  return all.some((t) => NO_ANYWHERE.has(t));
}

export const isYesWord = (token: string) => YES.has(token);

/** The words of each pay period, English and a few other languages. */
const PERIOD_WORDS: Record<(typeof PayPeriodSchema.options)[number], ReadonlySet<string>> = {
  hour: words("hour hours hourly hr stunde stunden stündlich heure horaire hora"),
  day: words("day days daily tag täglich jour journalier día diario"),
  week: words("week weeks weekly woche wöchentlich semaine hebdomadaire semana semanal"),
  month: words("month months monthly monat monatlich mois mensuel mes mensual"),
  year: words(
    "year years yearly annual annually annum yr jahr jahres jährlich année annuel año anual",
  ),
};

/** The work modes of a place, as written. */
const MODE_WORDS: Record<"onsite" | "hybrid", ReadonlySet<string>> = {
  onsite: words("onsite"),
  hybrid: words("hybrid hybride híbrido hibrido"),
};

const found = <K extends string>(table: Record<K, ReadonlySet<string>>, tokens: string[]): K[] =>
  (Object.keys(table) as K[]).filter((k) => tokens.some((t) => table[k].has(t)));

/** Every pay period the words name. */
export const periodsIn = (text: string) => found(PERIOD_WORDS, tokensOf(text));

/** Every work mode the words name. */
export const modesIn = (text: string) => found(MODE_WORDS, tokensOf(text));

/** Whether a word is one of the period or mode words. */
export const isFieldWord = (token: string) =>
  Object.values(PERIOD_WORDS).some((s) => s.has(token)) ||
  Object.values(MODE_WORDS).some((s) => s.has(token));

let currencies: ReadonlySet<string> | null = null;
const knownCurrencies = (): ReadonlySet<string> => {
  currencies ??= new Set(Intl.supportedValuesOf("currency"));
  return currencies;
};

const regions = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

/** Every ISO 4217 code written in capitals ("EUR 95,000"). */
export function currenciesIn(text: string): string[] {
  const codes = text.match(/\b[A-Z]{3}\b/g) ?? [];
  return [...new Set(codes.filter((c) => knownCurrencies().has(c)))];
}

/** Every ISO 3166-1 alpha-2 code written in capitals ("Dublin, IE"). */
export function countriesIn(text: string): string[] {
  const codes = text.match(/\b[A-Z]{2}\b/g) ?? [];
  return [
    ...new Set(
      codes.filter((c) => CountryCodeSchema.safeParse(c).success && regions.of(c) !== undefined),
    ),
  ];
}

/** Whether a currency sign in the words ("€", "$") isn't one of `currency`'s. */
export function otherCurrencySign(text: string, currency: string): boolean {
  const signs = text.match(/\p{Sc}/gu) ?? [];
  if (signs.length === 0) return false;
  let own = "";
  try {
    own = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(0)
      .filter((p) => p.type === "currency")
      .map((p) => p.value)
      .join("");
  } catch {
    return true;
  }
  return signs.some((s) => !own.includes(s));
}
