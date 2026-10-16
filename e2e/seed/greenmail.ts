import { SeedError } from "./load.ts";

// The test mail server's REST API (GreenMail standalone, on port 8080 of the imap service, which
// starts it because greenmail.hostname is set): users and the messages of a user's Inbox. The seed
// uses it where IMAP can't help: SMTP delivers to accounts nobody logs in to (inspect smtp), and
// only a new account gets a new UIDVALIDITY, since GreenMail never deletes an Inbox
// (reset-uidvalidity).

interface GreenMailUser {
  email: string;
  login: string;
}

interface GreenMailMessage {
  messageId: string | null;
  subject: string | null;
}

export interface GreenMailApi {
  users(): Promise<GreenMailUser[]>;
  /** The messages in a user's Inbox. */
  inbox(email: string): Promise<GreenMailMessage[]>;
  deleteUser(email: string): Promise<void>;
  createUser(user: GreenMailUser & { password: string }): Promise<void>;
}

export function greenMailApi(base: string, fetchImpl: typeof fetch = fetch): GreenMailApi {
  const url = (path: string) => `${base.replace(/\/$/, "")}${path}`;
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(url(path), {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new SeedError(
        `Can't reach the mail server's API at ${base}: ${error instanceof Error ? error.message : error}`,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw new SeedError(`The mail server's API answered ${response.status} to ${method} ${path}`);
    }
    return text === "" ? null : JSON.parse(text);
  };
  return {
    async users() {
      const list = (await call("GET", "/api/user")) as GreenMailUser[];
      return list.map(({ email, login }) => ({ email, login }));
    },
    async inbox(email) {
      const list = (await call(
        "GET",
        `/api/user/${encodeURIComponent(email)}/messages/`,
      )) as Record<string, unknown>[];
      return list.map((m) => ({
        messageId: typeof m["Message-ID"] === "string" ? m["Message-ID"] : null,
        subject: typeof m.subject === "string" ? m.subject : null,
      }));
    },
    async deleteUser(email) {
      await call("DELETE", `/api/user/${encodeURIComponent(email)}`);
    },
    async createUser(user) {
      await call("POST", "/api/user", user);
    },
  };
}
