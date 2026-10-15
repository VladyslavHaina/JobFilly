import {
  AcceptedInviteSchema,
  type PendingInvitation,
  PendingInvitationListSchema,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ApiError, api, apiVoid } from "../../api";
import { Alert, Button } from "../../components";
import { queryKeys } from "../../hooks";
import { paths } from "../../paths";

const ROLE_WORDS = { viewer: "a viewer", editor: "an editor", admin: "an admin" } as const;

/** "Maria invited you to “Maria's workspace” as a viewer". */
function invitationText(invitation: PendingInvitation): string {
  const inviter = invitation.invitedBy.trim().split(/\s+/)[0] || invitation.invitedBy;
  return `${inviter} invited you to “${invitation.workspaceName}” as ${ROLE_WORDS[invitation.role]}`;
}

export function usePendingInvitations() {
  return useQuery({
    queryKey: queryKeys.invitations,
    queryFn: async () => (await api("/api/invites", PendingInvitationListSchema)).items,
  });
}

/** Accepting opens the workspace; declining just removes the invitation. */
function useAnswerInvitation(token?: string) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const accept = useMutation({
    mutationFn: (id: string) =>
      api(`/api/invites/${encodeURIComponent(id)}/accept`, AcceptedInviteSchema, {
        method: "POST",
        body: token ? { token } : {},
      }),
    onSuccess: async ({ workspace }) => {
      await client.invalidateQueries({ queryKey: queryKeys.workspaces });
      await client.invalidateQueries({ queryKey: queryKeys.invitations });
      navigate(paths.inbox(workspace.id));
    },
  });
  const decline = useMutation({
    mutationFn: (id: string) =>
      apiVoid(`/api/invites/${encodeURIComponent(id)}/decline`, {
        method: "POST",
        body: token ? { token } : {},
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.invitations }),
  });
  return { accept, decline };
}

export function InvitationCard({
  invitation,
  token,
}: {
  invitation: PendingInvitation;
  token?: string;
}) {
  const { accept, decline } = useAnswerInvitation(token);
  const error = accept.error ?? decline.error;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3">
      <p className="text-sm text-indigo-950">{invitationText(invitation)}</p>
      <div className="flex gap-2">
        <Button busy={accept.isPending} onClick={() => accept.mutate(invitation.id)}>
          Accept
        </Button>
        <Button
          variant="secondary"
          busy={decline.isPending}
          onClick={() => decline.mutate(invitation.id)}
        >
          Decline
        </Button>
      </div>
      {error && (
        <div className="w-full">
          <Alert>
            {error instanceof ApiError ? error.message : "That didn't work. Try again."}
          </Alert>
        </div>
      )}
    </li>
  );
}

/** The signed-in user's invitations, shown on top of every page until answered. */
export function PendingInvitations() {
  const invitations = usePendingInvitations();
  if (!invitations.data?.length) return null;
  return (
    <section aria-label="Invitations" className="mb-6">
      <ul className="flex flex-col gap-2">
        {invitations.data.map((invitation) => (
          <InvitationCard key={invitation.id} invitation={invitation} />
        ))}
      </ul>
    </section>
  );
}
