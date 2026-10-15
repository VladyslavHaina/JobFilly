// How the fake AI reads a prompt, following the wire contract in e2e/fixtures/wire: the task id
// is the user message's first line ("task: <id>"), and the messages it is about are the
// "Message-ID: " lines at column 0. Mail content and the intake summary are prefixed with "| ",
// so no line of theirs can pass for one; reading stops at the summary block all the same.

export interface Prompt {
  taskId: string;
  messageIds: string[];
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
  return { taskId: first.slice("task: ".length).trim(), messageIds };
}
