// Mail access: IMAP (imapflow) and parsing (mailparser). Nothing in this package sends mail on
// its own; sending is one explicit call per message, made only after the user pressed send.

export {
  createMailClient,
  type MailClient,
  type MailClientOptions,
} from "./client";
export { MailError } from "./errors";
export { MAIL_PRESETS } from "./presets";
