import type { Address, MessageListItem, SenderCheck } from "@jobfilly/schema";

// The sender check in the UI (F5): a badge on each inbox row (looks fine, caution, high risk),
// and the reasons with trusted and blocked marks in the message detail. The slots' props are
// pinned by the foundation; the cvs-senders slice writes them.

interface SenderBadgeProps {
  sender: MessageListItem["sender"];
}

export function SenderBadge(_props: SenderBadgeProps) {
  return null;
}

interface SenderPanelProps {
  workspaceId: string;
  messageId: string;
  from: Address;
  check: SenderCheck | null;
}

export function SenderPanel(_props: SenderPanelProps) {
  return null;
}
