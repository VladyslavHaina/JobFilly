import {
  type Role,
  roleAtLeast,
  scopeOf,
  WorkspaceListSchema,
  type WorkspaceSummary,
} from "@jobfilly/schema";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import { api } from "../api";
import { queryKeys } from "./queryKeys";

/** The workspaces the signed-in user belongs to. */
export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: async () => (await api("/api/workspaces", WorkspaceListSchema)).items,
  });
}

export interface WorkspaceState {
  workspace: WorkspaceSummary;
  workspaceId: string;
  role: Role;
  /**
   * The UI mirrors the server's roles (F1.8): it hides or disables what the role can't do. `mail`
   * (MVP 3, F6.1) is false for a member who sees the job pipeline only: no message text, drafts
   * or sending.
   */
  can: { edit: boolean; admin: boolean; mail: boolean };
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

function workspaceState(workspace: WorkspaceSummary): WorkspaceState {
  return {
    workspace,
    workspaceId: workspace.id,
    role: workspace.role,
    can: {
      edit: roleAtLeast(workspace.role, "editor"),
      admin: roleAtLeast(workspace.role, "admin"),
      mail: scopeOf(workspace) === "everything",
    },
  };
}

export function WorkspaceProvider(props: { workspace: WorkspaceSummary; children: ReactNode }) {
  return (
    <WorkspaceContext.Provider value={workspaceState(props.workspace)}>
      {props.children}
    </WorkspaceContext.Provider>
  );
}

/** The current workspace and the user's role in it; only inside a workspace's pages. */
export function useWorkspace(): WorkspaceState {
  const state = useContext(WorkspaceContext);
  if (!state) throw new Error("useWorkspace is used outside a workspace page");
  return state;
}
