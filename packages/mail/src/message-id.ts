import { randomUUID } from "node:crypto";

// A draft's own Message-ID header. It is the one generator: draft.create (apps/server) chooses
// the ID with it before the append and keeps it on the draft row, so a retry can find the copy an
// earlier attempt left, and saveDraft uses it for a draft whose caller chose none.

const ADDRESS = /^[^\s@<>]+@([^\s@<>]+\.[^\s@<>]+)$/;

/** A new draft Message-ID ("<uuid@domain>") on the mailbox address's domain. */
export function newDraftMessageId(address: string): string {
  const domain = ADDRESS.exec(address.trim())?.[1] ?? "jobfilly.invalid";
  return `<${randomUUID()}@${domain}>`;
}
