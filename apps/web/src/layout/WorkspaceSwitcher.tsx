import { useNavigate } from "react-router";
import { useWorkspace, useWorkspaces } from "../hooks";
import { paths } from "../paths";

/** The current workspace, always visible, and the others the user belongs to (F1.7). */
export function WorkspaceSwitcher() {
  const { workspace } = useWorkspace();
  const workspaces = useWorkspaces();
  const navigate = useNavigate();
  const items = workspaces.data ?? [workspace];
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Workspace</span>
      <select
        aria-label="Workspace"
        value={workspace.id}
        onChange={(e) => navigate(paths.workspace(e.target.value))}
        className="max-w-56 truncate rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm font-medium text-stone-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      >
        {items.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </label>
  );
}
