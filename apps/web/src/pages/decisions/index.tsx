// The decision inbox in the UI (F7): the Decisions page, and the open count in the navigation.
// The slots' props are pinned by the foundation; the replies slice writes them.

interface DecisionsPageProps {
  workspaceId: string;
}

export function DecisionsPage(_props: DecisionsPageProps) {
  return null;
}

interface DecisionCountProps {
  workspaceId: string;
}

export function DecisionCount(_props: DecisionCountProps) {
  return null;
}
