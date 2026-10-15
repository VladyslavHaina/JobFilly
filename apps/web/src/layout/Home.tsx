import { MailboxListSchema } from "@jobfilly/schema";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { api } from "../api";
import { Loading } from "../components";
import { queryKeys, useWorkspace, useWorkspaces } from "../hooks";
import { apiPaths, paths } from "../paths";

/** "/": the user's own workspace (or the first one they belong to). */
export function Home() {
  const workspaces = useWorkspaces();
  if (workspaces.isLoading) return <Loading />;
  const target = workspaces.data?.find((w) => w.isOwner) ?? workspaces.data?.[0];
  return <Navigate to={target ? paths.workspace(target.id) : paths.invitations()} replace />;
}

/**
 * /w/:workspaceId: an admin of a workspace without a mailbox starts the onboarding; everyone
 * else lands in the job inbox.
 */
export function WorkspaceIndex() {
  const { workspaceId, can } = useWorkspace();
  const mailboxes = useQuery({
    queryKey: [...queryKeys.area(workspaceId, "workspace"), "mailboxes"],
    queryFn: () => api(`${apiPaths.workspace(workspaceId)}/mailboxes`, MailboxListSchema),
    enabled: can.admin,
    retry: false,
  });
  if (can.admin && mailboxes.isLoading) return <Loading />;
  const needsSetup = can.admin && mailboxes.data?.items.length === 0;
  return (
    <Navigate
      to={needsSetup ? paths.onboarding(workspaceId, "mailbox") : paths.inbox(workspaceId)}
      replace
    />
  );
}
