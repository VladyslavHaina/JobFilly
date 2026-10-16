import {
  type FreeMailDomainsFile,
  FreeMailDomainsFileSchema,
  type LanguageWordsFile,
  LanguageWordsFileSchema,
  type MessageSignalsFile,
  MessageSignalsFileSchema,
} from "@jobfilly/schema";
import freeMail from "./data/free-mail-domains.json";
import words from "./data/language-words.json";
import signals from "./data/message-signals.json";

// The sender check's data (F5, TBD-176). Data and not code, so market-specific lists grow
// without a code change:
//
//   data/free-mail-domains.json  {"version": 1, "domains": ["gmail.com", …]}: free-mail
//                                providers' domains, lower case.
//   data/message-signals.json    {"version": 1, "languages": {"en": {"asks_for_fee": […],
//                                "asks_for_id": […], "chat_only": […]}, "de": …, "pt": …}}:
//                                per ISO 639-1 language, phrases (lower case) that show a signal
//                                in a message body: asking for a fee, asking for ID documents or
//                                a passport scan before an offer, hiring only over chat.
//   data/language-words.json     {"version": 1, "languages": {"en": {"common": ["the", …],
//                                "negations": ["never", …]}, …}}: per ISO 639-1 language,
//                                common function words (to tell a message's language) and
//                                negations (so "never pay a fee" in a job board's footer isn't
//                                read as asking for one), lower case.
//
// All three are checked against their schemas in @jobfilly/schema the first time they are read.

let freeMailCache: FreeMailDomainsFile | null = null;
let signalsCache: MessageSignalsFile | null = null;
let wordsCache: LanguageWordsFile | null = null;

/** The free-mail domains of data/free-mail-domains.json. */
export function loadFreeMailDomains(): FreeMailDomainsFile {
  freeMailCache ??= FreeMailDomainsFileSchema.parse(freeMail);
  return freeMailCache;
}

/** The phrase lists of data/message-signals.json. */
export function loadMessageSignals(): MessageSignalsFile {
  signalsCache ??= MessageSignalsFileSchema.parse(signals);
  return signalsCache;
}

/** The word lists of data/language-words.json. */
export function loadLanguageWords(): LanguageWordsFile {
  wordsCache ??= LanguageWordsFileSchema.parse(words);
  return wordsCache;
}
