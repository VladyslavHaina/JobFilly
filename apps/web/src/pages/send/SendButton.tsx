import type { Draft, Send } from "@jobfilly/schema";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { ApiError, errorText } from "../../api";
import { Alert, Button, Dialog, Loading } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { useConfirmSend, useSendPreview, useUndoSend } from "./queries";

// Send on a draft card (F4.1–F4.5): one draft at a time. Send opens the confirmation with the
// message exactly as it will leave — from, to, cc, subject, attachments and the full text — and
// Send confirms that content. It then waits out its delay with Undo; if the draft changed
// meanwhile the server asks to confirm again. Viewers see the button disabled.

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Whole seconds until `at`, counted down on screen. */
function useSecondsUntil(at: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [at]);
  return at ? Math.max(0, Math.ceil((Date.parse(at) - now) / 1000)) : 0;
}

/** Each draft undone in this tab, by id, with its `updatedAt` then; an edit since changes it. */
const undoneVersion = new Map<string, string>();

/**
 * "Undone: nothing was sent." holds only for the draft as it was: once it is edited the note is
 * old news. The send has no time of its undo, so after a reload an edit counts as one made after
 * the moment it was due to leave.
 */
function stillUndone(draft: Draft, send: Send): boolean {
  const seen = undoneVersion.get(draft.id);
  if (seen !== undefined) return seen === draft.updatedAt;
  return Date.parse(draft.updatedAt) < Date.parse(send.sendAt);
}

function Waiting({ draft, send }: { draft: Draft; send: Send }) {
  const { workspaceId, can } = useWorkspace();
  const undo = useUndoSend(workspaceId, draft.id);
  const seconds = useSecondsUntil(send.status === "scheduled" ? send.sendAt : null);
  if (send.status === "sending" || seconds === 0) {
    return <span className="text-sm text-stone-600">Sending…</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span role="status" className="text-sm text-stone-700">
        Sending in {seconds} s
      </span>
      <Button
        variant="secondary"
        busy={undo.isPending}
        disabled={!can.edit}
        onClick={() => {
          // Before the request: the card leaves Waiting as soon as the undo lands.
          undoneVersion.set(draft.id, draft.updatedAt);
          undo.mutate(undefined);
        }}
      >
        Undo
      </Button>
      {undo.error && <Alert>{errorText(undo.error)}</Alert>}
    </span>
  );
}

function Confirmation({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { workspaceId } = useWorkspace();
  const preview = useSendPreview(workspaceId, draft.id, true);
  const confirm = useConfirmSend(workspaceId, draft.id);
  const shown = preview.data;
  const stale = confirm.error instanceof ApiError && confirm.error.code === "confirm_again";
  const noSmtp = preview.error instanceof ApiError && preview.error.code === "no_smtp";
  const delayId = useId();
  return (
    <Dialog
      title="Send this reply?"
      open
      onClose={onClose}
      actions={
        <>
          <p id={delayId} className="mr-auto self-center text-xs text-stone-500">
            It leaves 10 seconds after you press Send; until then you can undo it.
          </p>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            aria-describedby={delayId}
            busy={confirm.isPending}
            disabled={!shown || preview.isFetching}
            onClick={() => {
              if (!shown) return;
              confirm.mutate(shown.token, {
                onSuccess: onClose,
                // The draft changed since it was shown: show it as it is now, to confirm again.
                onError: () => void preview.refetch(),
              });
            }}
          >
            Send
          </Button>
        </>
      }
    >
      {preview.isLoading && <Loading label="Preparing the message…" />}
      {preview.error && (
        <Alert>
          {errorText(preview.error)}
          {noSmtp && (
            <>
              {" "}
              <Link className="underline" to={paths.settings(workspaceId, "sending")}>
                Settings › Sending
              </Link>
            </>
          )}
        </Alert>
      )}
      {confirm.error && (
        <Alert tone={stale ? "warning" : "error"}>{errorText(confirm.error)}</Alert>
      )}
      {shown && (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-stone-500">From</dt>
            <dd>{shown.from.address}</dd>
            <dt className="text-stone-500">To</dt>
            <dd>
              {shown.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ")}
            </dd>
            {shown.cc.length > 0 && (
              <>
                <dt className="text-stone-500">Cc</dt>
                <dd>{shown.cc.map((a) => a.address).join(", ")}</dd>
              </>
            )}
            <dt className="text-stone-500">Subject</dt>
            <dd>{shown.subject}</dd>
            <dt className="text-stone-500">Attached</dt>
            <dd>
              {shown.attachments.length === 0
                ? "Nothing"
                : shown.attachments.map((a) => `${a.fileName} (${kb(a.sizeBytes)})`).join(", ")}
            </dd>
          </dl>
          <section aria-label="Message text">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-stone-200 bg-stone-50 p-3 font-sans text-sm text-stone-800">
              {shown.text}
            </pre>
          </section>
        </div>
      )}
    </Dialog>
  );
}

export function SendButton({ draft }: { draft: Draft }) {
  const { can } = useWorkspace();
  const [open, setOpen] = useState(false);
  if (draft.status !== "in_mailbox" && draft.status !== "edited") return null;
  const send = draft.send ?? null;
  if (send && (send.status === "scheduled" || send.status === "sending")) {
    return <Waiting draft={draft} send={send} />;
  }
  return (
    <>
      <Button disabled={!can.edit} onClick={() => setOpen(true)}>
        Send…
      </Button>
      {send?.status === "cancelled" && stillUndone(draft, send) && (
        <span className="text-xs text-stone-500">Undone: nothing was sent.</span>
      )}
      {send?.status === "failed" && (
        <Alert tone="warning" title="Not sent">
          {send.failureReason}
        </Alert>
      )}
      {open && <Confirmation draft={draft} onClose={() => setOpen(false)} />}
    </>
  );
}
