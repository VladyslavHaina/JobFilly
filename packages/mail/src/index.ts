// Mail access: IMAP (imapflow), parsing (mailparser) and building drafts (nodemailer's
// MailComposer, which only composes). Drafts are only saved to the Drafts folder. From MVP 3 (F4)
// one confirmed message at a time is sent over SMTP, by ./smtp alone.

export {
  createMailClient,
  type MailClient,
  type MailClientOptions,
  MailUnavailableError,
  UNAVAILABLE_MESSAGES,
} from "./client";
export { FAILURE_MESSAGES, MailError } from "./errors";
export { MAIL_PRESETS } from "./presets";
export { type SmtpOptions, sendSmtp, testSmtp } from "./smtp";
