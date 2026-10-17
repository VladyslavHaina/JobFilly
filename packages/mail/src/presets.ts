import type { MailPreset } from "@jobfilly/schema";

/**
 * Provider presets (F2.1, F2.2): each fills host, port and TLS. Providers that only let mail apps
 * in with an app password say so and link to their own help page; the others link to their IMAP
 * help. "Other IMAP" leaves host, port and TLS to the user. From MVP 3 each also names its SMTP
 * server (F4, Settings › Sending); only Gmail is known to file sent mail in Sent by itself.
 */
export const MAIL_PRESETS: readonly MailPreset[] = [
  {
    id: "gmail",
    label: "Gmail",
    host: "imap.gmail.com",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: true,
    helpUrl: "https://support.google.com/accounts/answer/185833",
    smtp: { host: "smtp.gmail.com", port: 465, tlsMode: "tls", savesSentCopy: true },
  },
  {
    id: "icloud",
    label: "iCloud Mail",
    host: "imap.mail.me.com",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: true,
    helpUrl: "https://support.apple.com/en-us/102654",
    smtp: { host: "smtp.mail.me.com", port: 587, tlsMode: "starttls", savesSentCopy: false },
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    host: "imap.mail.yahoo.com",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: true,
    helpUrl: "https://help.yahoo.com/kb/SLN15241.html",
    smtp: { host: "smtp.mail.yahoo.com", port: 465, tlsMode: "tls", savesSentCopy: false },
  },
  {
    id: "fastmail",
    label: "Fastmail",
    host: "imap.fastmail.com",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: true,
    helpUrl: "https://www.fastmail.help/hc/en-us/articles/360058752854",
    smtp: { host: "smtp.fastmail.com", port: 465, tlsMode: "tls", savesSentCopy: false },
  },
  {
    id: "gmx",
    label: "GMX",
    host: "imap.gmx.net",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: false,
    helpUrl: "https://support.gmx.com/pop-imap/imap/index.html",
    smtp: { host: "mail.gmx.net", port: 587, tlsMode: "starttls", savesSentCopy: false },
  },
  {
    id: "webde",
    label: "WEB.DE",
    host: "imap.web.de",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: false,
    helpUrl: "https://hilfe.web.de/pop-imap/imap/imap-serverdaten.html",
    smtp: { host: "smtp.web.de", port: 587, tlsMode: "starttls", savesSentCopy: false },
  },
  {
    id: "other",
    label: "Other IMAP",
    host: "",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: false,
    helpUrl: null,
    smtp: null,
  },
];
