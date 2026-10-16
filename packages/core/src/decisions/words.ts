import { CountryCodeSchema } from "@jobfilly/schema";

// Reading the words of a decision's answer (F7.4) only for what every language writes the same
// way: digits, ISO 3166-1 country and ISO 4217 currency codes, currency signs, and the words
// the question's own group key or the profile's schema spell ("Dublin", "hybrid"). There are no
// word lists here: whether an answer is a yes or a no is never read from its words. The model
// that offers the answers says which ones turn the question down (draft.v1's `declines`), and
// words that don't state an item in this form write nothing (answers.ts).

/** The words of an answer, lower case: letters and digits, whatever the script. */
export function tokensOf(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** Whether two answers are the same words: "yes" typed is the "Yes" offered. */
export const sameWords = (a: string, b: string) => tokensOf(a).join(" ") === tokensOf(b).join(" ");

let currencies: ReadonlySet<string> | null = null;
const knownCurrencies = (): ReadonlySet<string> => {
  currencies ??= new Set(Intl.supportedValuesOf("currency"));
  return currencies;
};

// Only to tell an assigned region code from two capitals ("OK"): the names are never used.
const regions = new Intl.DisplayNames(["und"], { type: "region", fallback: "none" });

/** Whether `code` is an ISO 4217 code. */
export const isCurrencyCode = (code: string) => knownCurrencies().has(code);

/** Every ISO 4217 code written in capitals ("EUR 95,000"). */
export function currenciesIn(text: string): string[] {
  const codes = text.match(/\b[A-Z]{3}\b/g) ?? [];
  return [...new Set(codes.filter(isCurrencyCode))];
}

/** Whether `code` is an assigned ISO 3166-1 alpha-2 code. */
export const isCountryCode = (code: string) =>
  CountryCodeSchema.safeParse(code).success && regions.of(code) !== undefined;

/** Every ISO 3166-1 alpha-2 code written in capitals ("Dublin, IE"). */
export function countriesIn(text: string): string[] {
  const codes = text.match(/\b[A-Z]{2}\b/g) ?? [];
  return [...new Set(codes.filter(isCountryCode))];
}

/** The signs `currency` is written with ("€" for EUR, "$" for USD), never letters. */
export function currencySigns(currency: string): string[] {
  const signs = new Set<string>();
  for (const currencyDisplay of ["narrowSymbol", "symbol"] as const) {
    try {
      const sign = new Intl.NumberFormat("und", { style: "currency", currency, currencyDisplay })
        .formatToParts(0)
        .filter((p) => p.type === "currency")
        .map((p) => p.value)
        .join("");
      for (const s of sign.match(/\p{Sc}/gu) ?? []) signs.add(s);
    } catch {
      // Not a currency Intl knows: it has no sign.
    }
  }
  return [...signs];
}

/** Whether a currency sign in the words ("€", "$") isn't one of `currency`'s. */
export function otherCurrencySign(text: string, currency: string): boolean {
  const own = currencySigns(currency);
  return (text.match(/\p{Sc}/gu) ?? []).some((s) => !own.includes(s));
}
