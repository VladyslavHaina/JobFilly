// How the fake AI reads a prompt, following the wire contract in e2e/fixtures/wire: the task id
// is the user message's first line ("task: <id>"), and the messages it is about are the
// "Message-ID: " lines at column 0. Mail content and the intake summary are prefixed with "| ",
// so no line of theirs can pass for one; reading stops at the summary block all the same.
//
// The MVP 2 tasks name what they are about in key lines right after the task line, up to the
// first blank line (cv.v1 "CV-SHA256:", match.v1 "Message-ID:" and "Role:", draft.v1 also
// "Attempt:", assistant.v1 "Turn:"); assistant.v1's last block, "message", holds the user's words,
// one "| " line per line.

export interface Prompt {
  taskId: string;
  messageIds: string[];
  /** The key lines after the task line, by key ("CV-SHA256", "Role", …). */
  keys: Record<string, string>;
  /** The text of the last "message" block, without its "| " prefixes; null when there is none. */
  message: string | null;
}

interface ChatMessage {
  role?: unknown;
  content?: unknown;
}

/** The text of a message whose content is a string or a list of text parts. */
function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("");
  }
  return null;
}

/** The key lines right after the task line, up to the first blank line. */
function keyLines(lines: string[]): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const match = /^([A-Za-z0-9-]+): (.*)$/.exec(line);
    if (!match) break;
    keys[match[1] as string] = match[2] as string;
  }
  return keys;
}

/** The last "=== message ===" block at column 0; its forged look-alikes all start with "| ". */
function messageBlock(lines: string[]): string | null {
  const start = lines.lastIndexOf("=== message ===");
  if (start < 0) return null;
  const end = lines.indexOf("=== end message ===", start + 1);
  if (end < 0) return null;
  return lines
    .slice(start + 1, end)
    .map((line) => (line.startsWith("| ") ? line.slice(2) : line.replace(/^\|$/, "")))
    .join("\n");
}

export function parsePrompt(body: unknown): Prompt | { error: string } {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return { error: "the request has no messages" };
  const user = [...(messages as ChatMessage[])].reverse().find((m) => m?.role === "user");
  const text = textOf(user?.content);
  if (text === null) return { error: "the request has no user message" };
  const lines = text.split("\n");
  const first = lines[0] ?? "";
  if (!first.startsWith("task: "))
    return { error: "the user message does not start with a task id" };
  const messageIds: string[] = [];
  for (const line of lines.slice(1)) {
    if (line === "=== summary ===") break;
    if (line.startsWith("Message-ID: ")) messageIds.push(line.slice("Message-ID: ".length));
  }
  return {
    taskId: first.slice("task: ".length).trim(),
    messageIds,
    keys: keyLines(lines),
    message: messageBlock(lines),
  };
}
