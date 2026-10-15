// Mail access: IMAP (imapflow), parsing (mailparser) and building drafts. Nothing in this package
// sends mail on its own; sending is one explicit call per message, made only after the user
// pressed send. MVP 2 sends nothing at all (F6.6): drafts are only saved to the Drafts folder.

export {
  createMailClient,
  type MailClient,
  type MailClientOptions,
  MailUnavailableError,
} from "./client";
export { buildDraftMime, type DraftMimeInput } from "./drafts/index";
export { FAILURE_MESSAGES } from "./errors";
export { MAIL_PRESETS } from "./presets";
