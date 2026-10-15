// The assistant in the UI (F8): the launcher and panel on every page, and the profile history
// with Undo on the profile page. The slots' props are pinned by the foundation; the assistant
// slice writes them.

interface AssistantLauncherProps {
  workspaceId: string;
}

export function AssistantLauncher(_props: AssistantLauncherProps) {
  return null;
}

interface ProfileHistoryProps {
  workspaceId: string;
  profileId: string;
}

export function ProfileHistory(_props: ProfileHistoryProps) {
  return null;
}
