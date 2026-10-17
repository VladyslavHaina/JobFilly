import type { Draft } from "@jobfilly/schema";

// Sending (MVP 3, F4), built by the send slice: SendButton is the draft card's Send, with the
// confirmation dialog and Undo; SmtpSettings is Settings › Sending, each mailbox's SMTP server
// (the preset fills it) with its Test button. The foundation mounted both; until built they show
// nothing.

export function SendButton(_props: { draft: Draft }) {
  return null;
}

export function SmtpSettings(_props: { workspaceId: string }) {
  return null;
}
