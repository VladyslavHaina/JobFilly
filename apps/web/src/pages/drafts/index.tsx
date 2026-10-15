// Drafts in the UI (F6): the Drafts page with each draft's status, and the draft panel of a role
// in the message detail (edit, discard, Draft a reply). The slots' props are pinned by the
// foundation; the replies slice writes them.

interface DraftsPageProps {
  workspaceId: string;
}

export function DraftsPage(_props: DraftsPageProps) {
  return null;
}

interface DraftPanelProps {
  workspaceId: string;
  messageId: string;
  position: number;
}

export function DraftPanel(_props: DraftPanelProps) {
  return null;
}
