import type { MailPreset } from "@jobfilly/schema";

/**
 * Provider presets (F2.1, F2.2): each fills host, port and TLS. Providers that only let mail apps
 * in with an app password say so and link to their own help page; the others link to their IMAP
 * help. "Other IMAP" leaves host, port and TLS to the user.
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
  },
  {
    id: "icloud",
    label: "iCloud Mail",
    host: "imap.mail.me.com",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: true,
    helpUrl: "https://support.apple.com/en-us/102654",
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    host: "imap.mail.yahoo.com",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: true,
    helpUrl: "https://help.yahoo.com/kb/SLN15241.html",
  },
  {
    id: "fastmail",
    label: "Fastmail",
    host: "imap.fastmail.com",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: true,
    helpUrl: "https://www.fastmail.help/hc/en-us/articles/360058752854",
  },
  {
    id: "gmx",
    label: "GMX",
    host: "imap.gmx.net",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: false,
    helpUrl: "https://support.gmx.com/pop-imap/imap/index.html",
  },
  {
    id: "webde",
    label: "WEB.DE",
    host: "imap.web.de",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: false,
    helpUrl: "https://hilfe.web.de/pop-imap/imap/imap-serverdaten.html",
  },
  {
    id: "other",
    label: "Other IMAP",
    host: "",
    port: 993,
    tlsMode: "tls",
    needsAppPassword: false,
    helpUrl: null,
  },
];
