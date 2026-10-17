import type { Address, OutgoingPreview, SmtpEnvelope } from "@jobfilly/schema";
import { type AddressObject, simpleParser } from "mailparser";
import { buildDraftMime, type DraftMimeInput } from "../drafts";

// The outgoing message of one reviewed draft (F4.1, F4.4): the same RFC 5322 message the Drafts
// folder holds (drafts/index.ts builds both: the reply, the quote of the original, threading
// headers and the CV), with the Message-ID and Date it is sent with. The confirmation shows what
// is read back from these exact bytes, so what the user confirms is what leaves.

export interface OutgoingMessage {
  /** The bytes that go over SMTP and, unchanged, to the Sent folder. */
  raw: Uint8Array;
  envelope: SmtpEnvelope;
  preview: OutgoingPreview;
}

function addresses(field: AddressObject | AddressObject[] | undefined): Address[] {
  const objects = field === undefined ? [] : Array.isArray(field) ? field : [field];
  return objects
    .flatMap((o) => o.value)
    .filter((a) => a.address)
    .map((a) => ({ address: a.address ?? "", name: a.name || null }));
}

/** Builds the reply to send, with `messageId` and `date` as its own headers. */
export async function composeOutgoing(input: DraftMimeInput): Promise<OutgoingMessage> {
  const raw = await buildDraftMime(input);
  const mail = await simpleParser(raw, { skipTextToHtml: true, skipTextLinks: true });
  const preview: OutgoingPreview = {
    from: addresses(mail.from)[0] ?? input.from,
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    subject: mail.subject ?? "",
    text: mail.text ?? "",
    attachments: mail.attachments.map((a) => ({
      fileName: a.filename || "attachment",
      sizeBytes: a.size,
    })),
  };
  return {
    raw: new Uint8Array(raw),
    envelope: {
      from: input.from.address,
      to: [...preview.to, ...preview.cc].map((a) => a.address),
    },
    preview,
  };
}
