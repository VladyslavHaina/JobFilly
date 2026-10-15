import {
  type FreeMailDomainsFile,
  FreeMailDomainsFileSchema,
  type MessageSignalsFile,
  MessageSignalsFileSchema,
} from "@jobfilly/schema";
import freeMail from "./data/free-mail-domains.json";
import signals from "./data/message-signals.json";

// The sender check's data (F5, TBD-176). Data and not code, so market-specific lists grow
// without a code change (the language words of data/language-words.json load in ./language.ts):
//
//   data/free-mail-domains.json  {"version": 1, "domains": ["gmail.com", …]}: free-mail
//                                providers' domains, lower case.
//   data/message-signals.json    {"version": 1, "languages": {"en": {"asks_for_fee": […],
//                                "asks_for_id": […], "chat_only": […]}, "de": …, "pt": …}}:
//                                per ISO 639-1 language, phrases (lower case) that show a signal
//                                in a message body: asking for a fee, asking for ID documents or
//                                a passport scan before an offer, hiring only over chat.
//
// Both are checked against their schemas in @jobfilly/schema the first time they are read.

let freeMailCache: FreeMailDomainsFile | null = null;
let signalsCache: MessageSignalsFile | null = null;

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
