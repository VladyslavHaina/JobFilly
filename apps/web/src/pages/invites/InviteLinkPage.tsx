import { PendingInvitationSchema } from "@jobfilly/schema";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError, api } from "../../api";
import { Alert, Loading } from "../../components";
import { paths } from "../../paths";
import { InvitationCard } from "./PendingInvitations";

/** /invites/:inviteId?token=…: the page an invite link opens (after signing in or registering). */
export function InviteLinkPage() {
  const { inviteId = "" } = useParams();
  const [search] = useSearchParams();
  const token = search.get("token") ?? undefined;
  const invitation = useQuery({
    queryKey: ["invite-link", inviteId, token],
    queryFn: () =>
      api(
        `/api/invites/${encodeURIComponent(inviteId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
        PendingInvitationSchema,
      ),
    retry: false,
  });
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-xl font-semibold text-stone-900">Invitation</h1>
      {invitation.isLoading && <Loading />}
      {invitation.error && (
        <Alert title="This invitation can't be used">
          {invitation.error instanceof ApiError && invitation.error.status === 409
            ? "It has expired, was revoked, or was already answered."
            : "It doesn't exist, or it was sent to someone else."}{" "}
          <Link className="underline" to={paths.home()}>
            Go to JobFilly
          </Link>
        </Alert>
      )}
      {invitation.data && (
        <ul>
          <InvitationCard invitation={invitation.data} token={token} />
        </ul>
      )}
    </main>
  );
}
