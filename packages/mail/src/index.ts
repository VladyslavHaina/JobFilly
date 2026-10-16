// Mail access: IMAP (imapflow), parsing (mailparser) and building drafts (nodemailer's
// MailComposer, which only composes). Nothing in this package sends mail: MVP 2 has no send
// operation at all (F6.6), and drafts are only saved to the Drafts folder.

export {
  createMailClient,
  type MailClient,
  type MailClientOptions,
  MailUnavailableError,
  UNAVAILABLE_MESSAGES,
} from "./client";
export { FAILURE_MESSAGES, MailError } from "./errors";
export { MAIL_PRESETS } from "./presets";
