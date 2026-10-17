import type { SmtpEnvelope, SmtpLogin } from "@jobfilly/schema";
import type { SmtpPort } from "../deps";

// A fake SMTP server behind the SmtpPort (tests only, MVP 3 F4): it records every message sent,
// with the login and envelope, and the Test button's sign-ins; failNext makes the next send or
// test throw once. Owned by the send slice once it builds on it.

export interface FakeSmtp {
  port: SmtpPort;
  /** Every message sent, in order, its bytes as text. */
  sent: { login: SmtpLogin; envelope: SmtpEnvelope; raw: string }[];
  /** Every Test sign-in, in order. */
  tests: SmtpLogin[];
  failNext(error?: Error): void;
}

export function createFakeSmtp(): FakeSmtp {
  let failure: Error | null = null;
  const take = () => {
    const error = failure;
    failure = null;
    if (error) throw error;
  };
  const fake: FakeSmtp = {
    sent: [],
    tests: [],
    port: {
      async send(login, envelope, raw) {
        take();
        fake.sent.push({ login, envelope, raw: new TextDecoder().decode(raw) });
        return { accepted: envelope.to };
      },
      async test(login) {
        take();
        fake.tests.push(login);
        return { ok: true };
      },
    },
    failNext(error = new Error("fake SMTP failure")) {
      failure = error;
    },
  };
  return fake;
}
