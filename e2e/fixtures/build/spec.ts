import {
  type Address,
  type Category,
  type Folder,
  type IntakeAnswer,
  isJobCategory,
  type JobFacts,
  type Persona,
  type Preferences,
  type ProfileValues,
  type StageOneVerdict,
} from "../format.ts";
import type { Lang } from "./recruiters.ts";

// The source of truth of one persona: every message with its headers, its words and its ground
// truth, and the expected profile values. build.ts derives every fixture file from it.

export interface MessageSpec {
  messageId: string;
  folder: Folder;
  minutesAgo: number;
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  subject: string;
  /** What the message says; footer paragraphs are added until the text passes 1,000 chars. */
  body: string;
  footer: readonly string[];
  inReplyTo: string | null;
  references: string[];
  listId: string | null;
  listUnsubscribe: string | null;
  precedence: string | null;
  stageOne: StageOneVerdict;
  category: Category;
  facts: JobFacts[] | null;
  /** The language the message is written in (ISO 639-1): the CV choice follows it (MVP 2). */
  language: Lang;
  /** Sent messages only: what the reply states (the prefs.v1 answer). */
  preferences: Preferences | null;
  invalid: boolean;
  /**
   * Job mail the app analyses (MVP 2): each role's hard conflicts (F4.2), in position order,
   * written by hand from the persona's story, never worked out by a copy of the app's scorer.
   * Null on any other message.
   */
  hardConflicts: HardConflict[][] | null;
}

/** A hard conflict, named by the profile entry it conflicts with (F4.2). */
export type HardConflict = "places" | "min_pay";

export interface PersonaSource {
  persona: Persona;
  address: string;
  messages: MessageSpec[];
  /** The expected value of every core key; evidence is the replies stating it. */
  profile: ProfileValues;
  intake: IntakeAnswer;
}

/** The headers most messages leave out. */
type OptionalHeaders =
  | "cc"
  | "replyTo"
  | "inReplyTo"
  | "references"
  | "listId"
  | "listUnsubscribe"
  | "precedence"
  | "language"
  | "hardConflicts";

export type MessageInput = Omit<MessageSpec, "messageId" | OptionalHeaders> &
  Partial<Pick<MessageSpec, OptionalHeaders>>;

/** Collects a persona's messages, naming each <persona-nnnn@sender-domain> in source order. */
export class MessageBook {
  readonly messages: MessageSpec[] = [];
  readonly #persona: Persona;
  readonly #taken = new Set<number>();

  constructor(persona: Persona) {
    this.#persona = persona;
  }

  /** A free minutesAgo at or just after `wanted`, so no two messages share a time. */
  time(wanted: number): number {
    let t = Math.max(1, Math.round(wanted));
    while (this.#taken.has(t)) t += 1;
    this.#taken.add(t);
    return t;
  }

  add(input: MessageInput): MessageSpec {
    const seq = String(this.messages.length + 1).padStart(4, "0");
    const domain = input.from.address.slice(input.from.address.indexOf("@") + 1);
    const spec: MessageSpec = {
      cc: [],
      replyTo: [],
      inReplyTo: null,
      references: [],
      listId: null,
      listUnsubscribe: null,
      ...input,
      precedence: input.precedence ?? null,
      language: input.language ?? "en",
      hardConflicts: input.hardConflicts ?? null,
      messageId: `<${this.#persona}-${seq}@${domain}>`,
      minutesAgo: this.time(input.minutesAgo),
    };
    this.messages.push(spec);
    return spec;
  }
}

/** Whether the app analyses a message in MVP 2: job mail, not an own reply, not always invalid. */
export const isAnalysed = (m: MessageSpec): boolean =>
  isJobCategory(m.category) && m.stageOne !== "own_reply" && !m.invalid;

/**
 * A role as a conflict table names it: its places, its work mode and the top of its pay, the
 * facts a hard conflict comes from, e.g. "Munich hybrid ≤90000 EUR/year" or "remote".
 */
export function roleWhere(role: JobFacts): string {
  const place = role.places.map((p) => p.city ?? p.country).join("/");
  const pay = role.pay
    ? ` ≤${role.pay.max ?? "?"} ${role.pay.currency ?? "?"}/${role.pay.period ?? "?"}`
    : "";
  return `${[place, role.workMode ?? "mode not stated"].filter(Boolean).join(" ")}${pay}`;
}

const CONFLICT_WORDS: Readonly<Record<string, HardConflict[]>> = {
  none: [],
  places: ["places"],
  min_pay: ["min_pay"],
  "places, min_pay": ["places", "min_pay"],
};

/**
 * Gives every analysed message with no hard conflicts written at its role the ones `table`
 * writes for it. The table is keyed by the number in the Message-ID ("0046" for <maria-0046@…>),
 * one "<roleWhere>: <conflicts>" line per role in position order. A line whose role no longer
 * reads as written, a message with no lines, or lines no message uses throw, so a change to the
 * generator can't leave a role with stale ground truth.
 */
export function applyConflictTable(
  messages: readonly MessageSpec[],
  table: Readonly<Record<string, readonly string[]>>,
): void {
  const unused = new Set(Object.keys(table));
  for (const m of messages) {
    if (!isAnalysed(m) || m.hardConflicts !== null) continue;
    const key = /^<[a-z]+-(\d+)@/.exec(m.messageId)?.[1] ?? "";
    const lines = table[key];
    const roles = m.facts ?? [];
    if (lines === undefined) throw new Error(`no hard conflicts written for ${m.messageId}`);
    if (lines.length !== roles.length) {
      throw new Error(`${m.messageId} has ${roles.length} roles, ${lines.length} written`);
    }
    unused.delete(key);
    m.hardConflicts = roles.map((role, i) => {
      const line = lines[i] as string;
      const at = line.lastIndexOf(": ");
      const conflicts = CONFLICT_WORDS[line.slice(at + 2)];
      if (at < 0 || conflicts === undefined)
        throw new Error(`${m.messageId}: can't read "${line}"`);
      if (line.slice(0, at) !== roleWhere(role)) {
        throw new Error(`${m.messageId} role ${i} is "${roleWhere(role)}", written "${line}"`);
      }
      return conflicts;
    });
  }
  if (unused.size > 0) throw new Error(`conflicts written for no message: ${[...unused]}`);
}
