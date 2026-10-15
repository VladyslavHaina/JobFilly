import { Link } from "react-router";
import { Alert, Button, Card, Loading, PageHeader } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { DraftCard } from "./DraftCard";
import { errorText, useDraftReply, useDrafts } from "./queries";

// Drafts in the UI (F6): the Drafts page with each draft's status (in mailbox, edited,
// discarded, failed with the reason, F6.7), and the draft panel of a role in the message detail
// (edit, discard, Draft a reply on any role, F6.4, F6.5). Viewers read; changing takes an editor.

interface DraftsPageProps {
  workspaceId: string;
}

export function DraftsPage({ workspaceId }: DraftsPageProps) {
  const drafts = useDrafts(workspaceId);
  return (
    <div>
      <PageHeader
        title="Drafts"
        description="Replies written for you from your profile and CVs. They wait in your mailbox's Drafts folder; nothing is sent from here."
      />
      {drafts.isLoading && <Loading />}
      {drafts.error && <Alert>{errorText(drafts.error)}</Alert>}
      {drafts.data?.length === 0 && (
        <Card>
          <p className="text-sm text-stone-600">
            No drafts yet. Good matches get a reply here on their own, and you can ask for one on
            any role with Draft a reply.
          </p>
        </Card>
      )}
      <ul className="flex flex-col gap-4">
        {drafts.data?.map((draft) => (
          <li key={draft.id}>
            <Card>
              <DraftCard draft={draft} />
              <p className="mt-3 text-sm">
                <Link
                  className="text-indigo-700 hover:underline"
                  to={paths.message(workspaceId, draft.messageId)}
                >
                  Open the message
                </Link>
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface DraftPanelProps {
  workspaceId: string;
  messageId: string;
  position: number;
}

export function DraftPanel({ workspaceId, messageId, position }: DraftPanelProps) {
  const { can } = useWorkspace();
  const drafts = useDrafts(workspaceId, messageId);
  const ask = useDraftReply(workspaceId);
  if (drafts.isLoading) return <Loading label="Loading the draft…" />;
  const mine = (drafts.data ?? []).filter((d) => d.position === position);
  const live = mine.find((d) => d.status !== "discarded");
  const discarded = !live && mine.some((d) => d.status === "discarded");
  const canAsk = !live || live.status === "failed";

  return (
    <section
      aria-label={`Reply draft for role ${position + 1}`}
      className="flex flex-col gap-3 rounded-md border border-stone-200 p-3"
    >
      {live ? (
        <DraftCard draft={live} heading="Reply draft" />
      ) : (
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Reply draft</h3>
          <p className="mt-1 text-sm text-stone-600">
            {discarded
              ? "You discarded the draft for this role, so no new one is written on its own."
              : "No draft for this role."}
          </p>
        </div>
      )}
      {canAsk && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={live ? "secondary" : "primary"}
            disabled={!can.edit}
            busy={ask.isPending}
            onClick={() => ask.mutate({ messageId, position })}
          >
            Draft a reply
          </Button>
          {!can.edit && (
            <span className="text-xs text-stone-500">Only editors and admins can ask for one.</span>
          )}
        </div>
      )}
      {ask.error && <Alert>{errorText(ask.error)}</Alert>}
      {drafts.error && <Alert>{errorText(drafts.error)}</Alert>}
    </section>
  );
}
