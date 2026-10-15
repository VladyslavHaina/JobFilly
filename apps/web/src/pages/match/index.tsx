import type { MessageListItem, RoleEvaluation } from "@jobfilly/schema";

// The explainable match in the UI (F3.4, F4): the fit score on each row (never called an ATS
// score), the match panel per role in the message detail, why a message is hidden, and the
// Hidden filter. The slots' props are pinned by the foundation; the rules-match slice writes
// them.

interface FitScoreProps {
  fit: MessageListItem["fit"];
}

export function FitScore(_props: FitScoreProps) {
  return null;
}

interface MatchPanelProps {
  workspaceId: string;
  messageId: string;
  position: number;
  /** Null until the role is evaluated. */
  evaluation: RoleEvaluation | null;
}

export function MatchPanel(_props: MatchPanelProps) {
  return null;
}

interface HiddenReasonProps {
  hidden: MessageListItem["hidden"];
}

export function HiddenReason(_props: HiddenReasonProps) {
  return null;
}

/** The Hidden filter of the inbox: `value` true lists only hidden messages. */
interface HiddenFilterProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function HiddenFilter(_props: HiddenFilterProps) {
  return null;
}
