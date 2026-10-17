import {
  type AssistantLink,
  type AssistantMessage,
  AssistantStateSchema,
  type AssistantThread,
  AssistantTurnSchema,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../../api";
import { Alert, Button, Loading, Textarea, useEscapeLayer } from "../../components";
import { paths } from "../../paths";
import { ProposalCard } from "./ProposalCard";
import { assistantApi, assistantKey, errorText } from "./queries";

// The assistant (F8.1): a button on every page opens a panel with the member's conversation. The
// user writes in any language and the reply comes back in theirs; while the model thinks, the
// message shows with a "Thinking…" state (F8.9). A clarifying question offers its answers as
// buttons (F8.6), and a request to change preferences comes back as a proposal card. MVP 3: a
// question is answered, with links under the answer to the roles, messages, decisions and drafts
// it used (F8.1).

function Bubble({ message }: { message: Pick<AssistantMessage, "role" | "text"> }) {
  const mine = message.role === "user";
  return (
    <p
      className={`max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm ${
        mine ? "self-end bg-indigo-600 text-white" : "self-start bg-stone-100 text-stone-900"
      }`}
    >
      <span className="sr-only">{mine ? "You: " : "Assistant: "}</span>
      {message.text}
    </p>
  );
}

/** Where a link under an answer goes: the role's or message's page, the decisions or drafts. */
function linkTarget(workspaceId: string, link: AssistantLink): string {
  if (link.kind === "decision") return paths.decisions(workspaceId);
  if (link.kind === "draft") return paths.drafts(workspaceId);
  return link.messageId ? paths.message(workspaceId, link.messageId) : paths.inbox(workspaceId);
}

const LINK_KIND: Record<AssistantLink["kind"], string> = {
  role: "Role",
  message: "Message",
  decision: "Decision",
  draft: "Draft",
};

/** The roles, messages, decisions and drafts an answer used (MVP 3, F8.1). */
function Links({ workspaceId, links }: { workspaceId: string; links: AssistantLink[] }) {
  return (
    <ul aria-label="Used in this answer" className="flex flex-col gap-1 self-start text-sm">
      {links.map((link) => (
        <li key={`${link.kind} ${link.messageId ?? ""} ${link.position ?? ""} ${link.label}`}>
          <Link
            to={linkTarget(workspaceId, link)}
            className="text-indigo-700 underline hover:text-indigo-900"
          >
            {link.kind === "draft" ? link.label : `${LINK_KIND[link.kind]}: ${link.label}`}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Thread({
  thread,
  workspaceId,
  pending,
  onChoice,
}: {
  thread: AssistantThread | null;
  workspaceId: string;
  pending: string | null;
  onChoice: (choice: string) => void;
}) {
  const messages = thread?.messages ?? [];
  const last = messages.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {messages.length === 0 && !pending && (
        <p className="text-sm text-stone-600">
          Tell me how to treat your job mail, in any language: "Ignore jobs on Asian time zones",
          "Don't reply to agencies". I propose the change, and nothing changes until you apply it.
          Or ask about your job search: "What's waiting on me?", "How many interviews did I have
          this month?"
        </p>
      )}
      {messages.map((m) => {
        const proposal = m.proposalId
          ? thread?.proposals.find((p) => p.id === m.proposalId)
          : undefined;
        return (
          <div key={m.id} className="flex flex-col gap-2">
            <Bubble message={m} />
            {m.links && m.links.length > 0 && <Links workspaceId={workspaceId} links={m.links} />}
            {m.clarify && (
              <fieldset className="flex flex-col gap-2 self-start">
                <legend className="text-sm font-medium text-stone-800">{m.clarify.question}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.clarify.choices.map((choice) => (
                    <Button
                      key={choice}
                      variant="secondary"
                      className="px-2.5 py-1 text-xs"
                      disabled={pending !== null || m !== last}
                      onClick={() => onChoice(choice)}
                    >
                      {choice}
                    </Button>
                  ))}
                </div>
              </fieldset>
            )}
            {proposal && <ProposalCard workspaceId={workspaceId} proposal={proposal} />}
          </div>
        );
      })}
      {pending && (
        <>
          <Bubble message={{ role: "user", text: pending }} />
          <div className="self-start">
            <Loading label="Thinking…" />
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const titleId = useId();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const state = useQuery({
    queryKey: assistantKey(workspaceId),
    queryFn: () => api(assistantApi(workspaceId), AssistantStateSchema),
  });
  const thread = state.data?.thread ?? null;
  // The thread the next message goes to. The first reply names it, and it is kept from then on:
  // a message sent before the refetch brings the thread back stays in it, not in a new one.
  const threadId = useRef<string | null>(null);
  if (thread) threadId.current = thread.id;
  const send = useMutation({
    mutationFn: (message: string) =>
      api(assistantApi(workspaceId), AssistantTurnSchema, {
        method: "POST",
        body: { threadId: threadId.current, text: message },
      }),
    onSuccess: (turn) => {
      threadId.current = turn.threadId;
      return client.invalidateQueries({ queryKey: assistantKey(workspaceId) });
    },
  });
  const pending = send.isPending ? (send.variables ?? null) : null;
  const ask = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || send.isPending) return;
    // The message moves into the thread at once; it comes back to the field if sending fails.
    setText("");
    send.mutate(trimmed, { onError: () => setText((t) => t || trimmed) });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(text);
    }
  };
  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    if (count > 0 || pending) bottom.current?.scrollIntoView?.({ block: "end" });
  }, [count, pending]);
  // Esc closes the panel only, not an open message under it (nor itself under a dialog).
  useEscapeLayer(true, (e) => {
    e.preventDefault();
    onClose();
  });
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      className="fixed right-4 bottom-20 z-40 flex max-h-[75vh] w-[min(28rem,calc(100vw-2rem))] flex-col rounded-lg border border-stone-200 bg-white shadow-lg"
    >
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <h2 id={titleId} className="text-base font-semibold text-stone-900">
          Assistant
        </h2>
        <Button
          variant="ghost"
          className="px-2 py-1"
          aria-label="Close the assistant"
          onClick={onClose}
        >
          ×
        </Button>
      </header>
      <div aria-live="polite" className="flex-1 overflow-y-auto px-4 py-3">
        {state.isPending && <Loading />}
        {state.isError && <Alert>{errorText(state.error)}</Alert>}
        {state.isSuccess && (
          <Thread thread={thread} workspaceId={workspaceId} pending={pending} onChoice={ask} />
        )}
        {send.isError && (
          <div className="mt-3">
            <Alert>{errorText(send.error)}</Alert>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2 border-t border-stone-200 px-4 py-3">
        <Textarea
          label="Message"
          value={text}
          rows={2}
          className="[&_textarea]:min-h-16"
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex justify-end">
          <Button type="submit" busy={send.isPending} disabled={text.trim() === ""}>
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}

interface AssistantLauncherProps {
  workspaceId: string;
}

/** The Assistant button on every page of a workspace, and the panel it opens (F8.1). */
export function AssistantLauncher({ workspaceId }: AssistantLauncherProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && <Panel workspaceId={workspaceId} onClose={() => setOpen(false)} />}
      <div className="fixed right-4 bottom-4 z-40">
        <Button aria-expanded={open} onClick={() => setOpen((o) => !o)} className="shadow-lg">
          Assistant
        </Button>
      </div>
    </>
  );
}
