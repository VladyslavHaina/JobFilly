// Continuous sync in the UI (F1.4, F1.5): the mailbox status in the inbox header ("Synced 2
// minutes ago", "Can't reach the mail server since 10:42") and the model usage per day in
// Settings › AI. The slots' props are pinned by the foundation; the mailbox slice writes them.

interface MailboxStatusProps {
  workspaceId: string;
}

export function MailboxStatus(_props: MailboxStatusProps) {
  return null;
}

interface UsagePerDayProps {
  workspaceId: string;
}

export function UsagePerDay(_props: UsagePerDayProps) {
  return null;
}
