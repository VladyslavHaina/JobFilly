import type { Address, DraftMailInput } from "@jobfilly/schema";

// Building a draft's MIME message (F6.3): the reply text, the quote of the original (added here,
// so the database never stores a mail body), In-Reply-To and References to thread it, and the
// chosen CV as an attachment. The input type is pinned by the foundation; the mailbox slice
// writes the body of buildDraftMime.

export interface DraftMimeInput extends DraftMailInput {
  /** The mailbox's own address: the draft's From. */
  from: Address;
  /** The draft's own Message-ID header, "<...>". */
  messageId: string;
  date: Date;
}

/** The draft as an RFC 5322 message, ready to append to the Drafts folder. */
export function buildDraftMime(_input: DraftMimeInput): string {
  throw new Error("buildDraftMime is written by the mailbox slice");
}
