// Mail access: IMAP sync (imapflow), message parsing (mailparser) and saving
// drafts (nodemailer builds the MIME). Nothing in this package sends mail on
// its own; sending is one explicit call per message, made only after the user
// pressed send.
export {};
