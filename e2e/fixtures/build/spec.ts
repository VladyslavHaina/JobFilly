import type {
  Address,
  Category,
  Folder,
  IntakeAnswer,
  JobFacts,
  Persona,
  Preferences,
  ProfileValues,
  StageOneVerdict,
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
}

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
  | "language";

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
      messageId: `<${this.#persona}-${seq}@${domain}>`,
      minutesAgo: this.time(input.minutesAgo),
    };
    this.messages.push(spec);
    return spec;
  }
}
