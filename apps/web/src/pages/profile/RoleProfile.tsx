import { RoleProfileSchema, type RoleProfile as RoleProfileValue } from "@jobfilly/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api";
import { Alert, SelectField } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";
import { useProfiles } from "../intake/queries";

// The profile a role belongs to, with why ("Munich role, German, permanent → 'Germany
// permanent'"), shown on every role of the message detail (MVP 3, F1.3). With more than one
// profile on, editors put the role in another profile by hand; its match, CV choice and drafting
// then use that profile once it is evaluated again, which the detail shows when it refetches.

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : "That didn't work. Try again.";

export function RoleProfile(props: {
  workspaceId: string;
  messageId: string;
  position: number;
  profile: RoleProfileValue | null;
}) {
  const { workspaceId, messageId, position, profile } = props;
  const { can } = useWorkspace();
  const client = useQueryClient();
  const profiles = useProfiles(workspaceId);
  const change = useMutation({
    mutationFn: (profileId: string) =>
      api(
        `${apiPaths.message(workspaceId, messageId)}/roles/${position}/profile`,
        RoleProfileSchema,
        {
          method: "PUT",
          body: { profileId },
        },
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "messages") }),
  });
  // The choice shows at once; the refetched role takes over once it names that profile.
  const shown = change.data && change.data.profileId !== profile?.profileId ? change.data : profile;
  const on = (profiles.data ?? []).filter((p) => p.confirmedAt !== null && p.enabled !== false);
  return (
    <section
      aria-label={`Profile for role ${position + 1}`}
      className="flex flex-col gap-1.5 text-sm"
    >
      <p className="text-stone-700">
        <span className="font-medium text-stone-900">Profile: </span>
        {shown ? shown.reason : "Not assigned yet: the role hasn't been evaluated."}
      </p>
      {can.edit && on.length > 1 && (
        <SelectField
          label={`Put role ${position + 1} in another profile`}
          value={change.isPending ? change.variables : (shown?.profileId ?? "")}
          disabled={change.isPending}
          onChange={(e) => e.target.value && change.mutate(e.target.value)}
        >
          {!shown && <option value="">Choose a profile</option>}
          {on.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      )}
      {change.isError && <Alert>{errorText(change.error)}</Alert>}
    </section>
  );
}
