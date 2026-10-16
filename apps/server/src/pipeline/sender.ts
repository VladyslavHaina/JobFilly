import {
  checkSender,
  type DomainFacts,
  detectLanguage,
  isFreeMailDomain,
  senderDomain,
} from "@jobfilly/core";
import { findSenderMark } from "@jobfilly/db";
import { lookupDomain } from "../senders/lookup";
import { MessageGoneError, type SenderStage } from "./stages";

// The sender stage (F5): the message's signals from its body (read once through ctx.body(),
// never stored, so it works the same for new mail and for the backlog fetched from IMAP), the
// domain's age and MX records (deps.domains through the workspace's cache), and an editor's mark,
// which decides the verdict and skips the lookups. It also tells the body's language, which the
// pipeline stores for the CV choice. A message gone from the mailbox still gets what can be told
// without its text, marked incomplete. Any other failure (the mailbox can't be reached) is let
// through, so the check stays missing and is done on a later sweep.

const NOT_LOOKED_UP: DomainFacts = { rdap: null, mx: null };

export const senderStage: SenderStage = async ({ message }, ctx) => {
  let text: string | null;
  try {
    text = await ctx.body();
  } catch (error) {
    if (!(error instanceof MessageGoneError)) throw error;
    text = null;
  }
  const language = text === null ? message.language : detectLanguage(text);
  const mark = await findSenderMark(ctx.deps.db, ctx.ws, message.from.address);
  const domain = senderDomain(message.from.address);
  // A free-mail provider's domain says nothing about the sender, and a mark decides anyway.
  const facts =
    mark || !domain || isFreeMailDomain(domain)
      ? NOT_LOOKED_UP
      : await lookupDomain(ctx.deps, ctx.ws, domain, ctx.log);
  const companies = message.facts.flatMap((f) =>
    [f.company, f.agency?.name].filter((n): n is string => Boolean(n)),
  );
  const check = checkSender({
    from: message.from,
    category: message.category,
    companies,
    text,
    language,
    domain: facts,
    mark,
    now: ctx.now,
  });
  ctx.log.info("sender.checked", { verdict: check.verdict, complete: check.complete });
  return { check, language };
};
