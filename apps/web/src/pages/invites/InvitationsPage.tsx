import { Link } from "react-router";
import { Card, Loading, PageHeader } from "../../components";
import { useWorkspaces } from "../../hooks";
import { paths } from "../../paths";
import { InvitationCard, usePendingInvitations } from "./PendingInvitations";

/** /invitations: every pending invitation of the signed-in user. */
export function InvitationsPage() {
  const invitations = usePendingInvitations();
  const workspaces = useWorkspaces();
  const home = workspaces.data?.find((w) => w.isOwner) ?? workspaces.data?.[0];
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <PageHeader title="Invitations" />
      {invitations.isLoading ? (
        <Loading />
      ) : invitations.data?.length ? (
        <ul className="flex flex-col gap-2">
          {invitations.data.map((invitation) => (
            <InvitationCard key={invitation.id} invitation={invitation} />
          ))}
        </ul>
      ) : (
        <Card>
          <p className="text-sm text-stone-600">No invitations waiting for you.</p>
        </Card>
      )}
      {home && (
        <p className="mt-6 text-sm">
          <Link className="text-indigo-700 hover:underline" to={paths.workspace(home.id)}>
            Go to {home.name}
          </Link>
        </p>
      )}
    </main>
  );
}
