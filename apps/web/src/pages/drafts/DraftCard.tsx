import type { Draft } from "@jobfilly/schema";
import { useState } from "react";
import { errorText } from "../../api";
import { Alert, Badge, Button, Dialog, Textarea, TextField } from "../../components";
import { useWorkspace } from "../../hooks";
import { SendButton } from "../send";
import { STATUS_LABELS, useDiscardDraft, useEditDraft } from "./queries";

// One draft (F6.4, F6.7): its status, the failed reason, the reply text, and for editors Edit
// (saving replaces the copy in the mailbox) and Discard (deletes it there; a failed draft can be
// discarded too). Viewers read it; the buttons stay visible but disabled, with why.

const TONES = {
  saving: "info",
  in_mailbox: "success",
  edited: "info",
  discarded: "neutral",
  failed: "danger",
  sent: "success",
} as const;

function DraftStatusBadge({ status }: { status: Draft["status"] }) {
  return (
    <Badge tone={TONES[status]} label={`Draft status: ${STATUS_LABELS[status]}`}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function Editor({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const { workspaceId } = useWorkspace();
  const edit = useEditDraft(workspaceId, draft.id);
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body ?? "");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        edit.mutate({ subject, body }, { onSuccess: onDone });
      }}
    >
      <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <Textarea
        label="Reply"
        rows={10}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        hint="Saving replaces the draft in your mailbox's Drafts folder. Nothing is sent."
      />
      {edit.error && <Alert>{errorText(edit.error)}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" busy={edit.isPending} disabled={!subject.trim() || !body.trim()}>
          Save
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={edit.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function DraftCard({ draft, heading }: { draft: Draft; heading?: string }) {
  const { workspaceId, can } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const discard = useDiscardDraft(workspaceId, draft.id);
  const live = draft.status === "in_mailbox" || draft.status === "edited";
  const changeable = can.edit && live;
  // A failed draft can go too: an append that failed may still have left a copy, deleted with it.
  const discardable = live || draft.status === "failed";
  const title =
    draft.subject ?? (draft.status === "saving" ? "Writing the reply…" : "No reply text");

  return (
    <article aria-label={heading ?? title} className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-stone-900">{heading ?? title}</h3>
        <DraftStatusBadge status={draft.status} />
        <span className="text-xs text-stone-500">
          {draft.auto ? "Written automatically" : "Drafted on request"}
          {draft.language ? ` · ${draft.language.toUpperCase()}` : ""}
          {draft.cvAttached ? " · CV attached" : ""}
        </span>
      </header>

      {draft.status === "failed" && (
        <Alert tone="warning" title="This draft failed">
          {draft.failureReason ?? "It couldn't be saved."}
        </Alert>
      )}

      {editing ? (
        <Editor draft={draft} onDone={() => setEditing(false)} />
      ) : (
        draft.body !== null && (
          <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
            {heading && draft.subject && (
              <p className="mb-2 text-sm font-medium text-stone-800">{draft.subject}</p>
            )}
            <p className="whitespace-pre-wrap text-sm text-stone-800">{draft.body}</p>
          </div>
        )
      )}

      {discardable && !editing && (
        <div className="flex flex-wrap items-center gap-2">
          {live && (
            <Button variant="secondary" disabled={!changeable} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <Button variant="danger" disabled={!can.edit} onClick={() => setConfirming(true)}>
            Discard
          </Button>
          <SendButton draft={draft} />
          {!can.edit && (
            <span className="text-xs text-stone-500">
              Viewers can read drafts but not change them.
            </span>
          )}
        </div>
      )}
      {discard.error && <Alert>{errorText(discard.error)}</Alert>}

      <Dialog
        title="Discard this draft?"
        open={confirming}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              busy={discard.isPending}
              onClick={() => discard.mutate(undefined, { onSettled: () => setConfirming(false) })}
            >
              Discard
            </Button>
          </>
        }
      >
        It's deleted from your mailbox's Drafts folder, and the app won't write another one for this
        role on its own. You can still use Draft a reply later.
      </Dialog>
    </article>
  );
}
