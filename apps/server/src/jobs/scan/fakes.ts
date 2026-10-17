import type { AiClient } from "@jobfilly/ai";
import { type MailClient, MailError } from "@jobfilly/mail";
import {
  type AiError,
  type AiMailItem,
  type BatchResult,
  type Category,
  CORE_PROFILE_KEYS,
  CORE_PROFILE_LABELS,
  type Envelope,
  type IntakeInput,
  type IntakeProposal,
  type JobFacts,
  type MailLogin,
  NOT_ENOUGH_EVIDENCE,
  type Preferences,
  type ProfileValue,
  type ScanFocus,
  type TaskId,
  type Usage,
} from "@jobfilly/schema";
import type { AiPort, MailPort } from "../../deps";
import { fakeAiClient, fakeMailClient } from "../../testing";

// Test doubles for the scan worker's ports, behaving as packages/mail and packages/ai promise:
// envelopes newest first within the window, bodies on demand; one Usage per model call, invalid
// items retried once in one follow-up call when maxCalls allows it, else not_retried.
// Only the scan tests import this file.

/** Every fake body carries this marker, so tests can prove no body is stored or logged (F4.9). */
export const BODY_SENTINEL = "BODYSENTINEL-scan";

export interface FakeMail {
  port: MailPort;
  connections: MailLogin[];
  fetched: { folder: string; since: Date }[];
  bodies: string[];
  closed: number;
  /** From now on, reading envelopes or bodies throws, the way packages/mail does on a fault. */
  failing: { envelopes: boolean; bodies: boolean };
}

/**
 * One mailbox's envelopes, or (MVP 3, F3.1) each mailbox's by the user name it logs in with; then
 * `bodies` records "<user name> <Message-ID>".
 */
export function fakeMail(
  mail: readonly Envelope[] | Readonly<Record<string, readonly Envelope[]>>,
): FakeMail {
  const fake: FakeMail = {
    connections: [],
    fetched: [],
    bodies: [],
    closed: 0,
    failing: { envelopes: false, bodies: false },
    port: {
      connect(conn) {
        fake.connections.push(conn);
        const several = !Array.isArray(mail);
        const envelopes: readonly Envelope[] = several
          ? ((mail as Record<string, readonly Envelope[]>)[conn.username] ?? [])
          : (mail as readonly Envelope[]);
        const client: MailClient = fakeMailClient({
          async test() {
            return { ok: true, folders: ["INBOX", "Sent"], sentPath: "Sent" };
          },
          async fetchEnvelopes({ folder, since }) {
            if (fake.failing.envelopes) throw new Error("fake mailbox failure");
            fake.fetched.push({ folder, since });
            return envelopes
              .filter((e) => e.folder === folder && Date.parse(e.date) >= since.getTime())
              .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
          },
          async fetchBody(ref) {
            // As packages/mail fails when the server dropped the connection.
            if (fake.failing.bodies) throw new MailError("unreachable", "NoConnection");
            const e = envelopes.find(
              (x) => x.folderPath === ref.folderPath && x.uid === ref.uid,
            ) as Envelope;
            fake.bodies.push(several ? `${conn.username} ${e.messageId}` : e.messageId);
            return { text: `${e.snippet}\n\n${"More text. ".repeat(100)}${BODY_SENTINEL}` };
          },
          async close() {
            fake.closed += 1;
          },
        });
        return client;
      },
    },
  };
  return fake;
}

/**
 * An answer the fake model gives for one message; "invalid" fails its schema every time, and
 * "fails" makes every request carrying the message an HTTP 500, as the test stack's fake AI
 * answers a message it has no answer for.
 */
type Answer<T> = T | "invalid" | "fails" | undefined;

export interface FakeAiAnswers {
  classify?: (messageId: string) => Answer<Category>;
  extract?: (messageId: string) => Answer<JobFacts[]>;
  prefs?: (messageId: string) => Answer<Preferences>;
  /** MVP 3: focus.v1's answer for a re-run's hint. */
  focus?: (hint: string) => Answer<ScanFocus>;
}

export interface FakeAi {
  port: AiPort;
  /** Every call made, in order: the task and the Message-IDs it carried. */
  calls: { task: TaskId; ids: string[] }[];
  /** Every call from now on fails the way a provider does, with the error's codes if given. */
  failWith(
    kind: AiError["kind"] | null,
    codes?: Pick<AiError, "httpStatus" | "providerErrorType">,
  ): void;
  /** Called before every call answers (n counts calls from 1); a test can act mid-run, or
   * hold one call by returning a promise it resolves later. */
  beforeAnswer: ((task: TaskId, n: number) => Promise<void> | void) | null;
}

const usage = (task: TaskId): Usage => ({ task, inputTokens: 100, outputTokens: 10 });

export function fakeAi(answers: FakeAiAnswers): FakeAi {
  let failure: AiError | null = null;

  const fake: FakeAi = {
    calls: [],
    beforeAnswer: null,
    failWith(kind, codes) {
      failure = kind && { kind, message: "fake failure", ...codes };
    },
    port: { client: () => client },
  };

  async function request(task: TaskId, ids: string[]) {
    fake.calls.push({ task, ids });
    await fake.beforeAnswer?.(task, fake.calls.length);
  }

  async function batch<T>(
    task: TaskId,
    items: AiMailItem[],
    maxCalls: 1 | 2,
    answer: (id: string) => Answer<T>,
  ): Promise<BatchResult<T>> {
    const result: BatchResult<T> = { items: [], usage: [] };
    let pending = items.map((i) => i.messageId);
    for (let attempt = 1; pending.length > 0 && attempt <= maxCalls; attempt++) {
      await request(task, pending);
      result.usage.push(usage(task));
      const fails = pending.some((id) => answer(id) === "fails");
      if (failure || fails) {
        const error: AiError = failure ?? {
          kind: "provider_error",
          message: "fake failure",
          httpStatus: 500,
        };
        for (const messageId of pending) result.items.push({ messageId, ok: false, error });
        return result;
      }
      const next: string[] = [];
      for (const messageId of pending) {
        const data = answer(messageId);
        if (data === undefined) throw new Error(`fake AI has no ${task} answer for ${messageId}`);
        if (data === "invalid" || data === "fails") next.push(messageId);
        else result.items.push({ messageId, ok: true, data });
      }
      pending = next;
    }
    const kind = maxCalls === 1 ? "not_retried" : "invalid_output";
    for (const messageId of pending) {
      result.items.push({ messageId, ok: false, error: { kind, message: kind } });
    }
    return result;
  }

  const client: AiClient = fakeAiClient({
    async classify(items, options) {
      const r = await batch("classify.v1", items, options?.maxCalls ?? 2, (id) =>
        answers.classify?.(id),
      );
      return {
        usage: r.usage,
        items: r.items.map((i) => (i.ok ? { ...i, data: { category: i.data } } : i)),
      };
    },
    async prefs(items, options) {
      const r = await batch("prefs.v1", items, options?.maxCalls ?? 2, (id) => answers.prefs?.(id));
      return {
        usage: r.usage,
        items: r.items.map((i) => (i.ok ? { ...i, data: { preferences: i.data } } : i)),
      };
    },
    async extract(item, options) {
      const r = await batch("extract.v1", [item], options?.maxCalls ?? 2, (id) =>
        answers.extract?.(id),
      );
      const only = r.items[0];
      if (!only) throw new Error("fake AI returned nothing");
      return only.ok
        ? { ok: true, data: { messageId: item.messageId, roles: only.data }, usage: r.usage }
        : { ok: false, error: only.error, usage: r.usage };
    },
    async focus({ hint }, options) {
      const r = await batch(
        "focus.v1",
        [{ messageId: hint } as AiMailItem],
        options?.maxCalls ?? 2,
        (h) => answers.focus?.(h),
      );
      const only = r.items[0];
      if (!only) throw new Error("fake AI returned nothing");
      return only.ok
        ? { ok: true, data: only.data, usage: r.usage }
        : { ok: false, error: only.error, usage: r.usage };
    },
    async intake() {
      throw new Error("the scan never makes the intake.v1 call");
    },
    async test() {
      throw new Error("the scan never tests the provider");
    },
  });
  return fake;
}

/**
 * A stand-in for packages/core's aggregateIntake, built by another slice: each core key's values
 * are those the user's replies state, with the replies as evidence; 1 reply is low confidence,
 * 2 medium, 3 or more high. Job mail adds nothing.
 */
export function aggregateFromReplies(input: IntakeInput): IntakeProposal {
  return {
    entries: CORE_PROFILE_KEYS.map((key) => {
      const values = new Map<string, unknown>();
      const evidence: string[] = [];
      for (const reply of input.replies) {
        const stated = reply.preferences[key] ?? [];
        if (stated.length === 0) continue;
        evidence.push(reply.messageId);
        for (const v of stated) values.set(JSON.stringify(v), v);
      }
      const n = evidence.length;
      return {
        key,
        label: CORE_PROFILE_LABELS[key],
        value: [...values.values()] as ProfileValue,
        confidence: n === 0 ? null : n === 1 ? "low" : n === 2 ? "medium" : "high",
        evidence: evidence.map((messageId) => ({ messageId, reason: `from ${n} of your replies` })),
        emptyReason: n === 0 ? NOT_ENOUGH_EVIDENCE : null,
      };
    }),
  };
}
