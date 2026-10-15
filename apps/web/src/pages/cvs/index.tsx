import type { CvChoice as CvChoiceValue } from "@jobfilly/schema";

// CVs in the UI (F2): the CVs page (upload, tags, download, delete), each role's CV choice with
// its reason and an editor's override, and the CV prompt on the profile page. The slots' props
// are pinned by the foundation; the cvs-senders slice writes them.

interface CvsPageProps {
  workspaceId: string;
}

export function CvsPage(_props: CvsPageProps) {
  return null;
}

interface CvChoiceProps {
  workspaceId: string;
  messageId: string;
  position: number;
  /** The CV the app would use, or the editor's; null until chosen. */
  choice: CvChoiceValue | null;
}

export function CvChoice(_props: CvChoiceProps) {
  return null;
}

interface ProfileCvPromptProps {
  workspaceId: string;
  profileId: string;
}

export function ProfileCvPrompt(_props: ProfileCvPromptProps) {
  return null;
}
