import { AccountDeletionPreviewSchema } from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, apiVoid, errorText } from "../../api";
import { Alert, Button, Card, Loading, PageHeader, TextField } from "../../components";
import { queryKeys, useSession } from "../../hooks";
import { apiPaths, paths } from "../../paths";

// The signed-in user's account (MVP 3, F6.3, F7.3): the workspaces they belong to, each of which
// they can leave, and deleting the account, after listing the workspaces it owns and their
// members. Deleting asks for the password.

const PREVIEW_KEY = ["account", "deletion"] as const;

function LeaveButton({ workspaceId, name }: { workspaceId: string; name: string }) {
  const { user } = useSession();
  const client = useQueryClient();
  const leave = useMutation({
    mutationFn: () =>
      apiVoid(`${apiPaths.workspace(workspaceId)}/members/${user?.id ?? ""}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: PREVIEW_KEY }),
        client.invalidateQueries({ queryKey: queryKeys.workspaces }),
      ]),
  });
  return (
    <>
      <Button
        variant="secondary"
        aria-label={`Leave ${name}`}
        busy={leave.isPending}
        onClick={() => leave.mutate()}
      >
        Leave
      </Button>
      {leave.error && <Alert>{errorText(leave.error)}</Alert>}
    </>
  );
}

function DeleteAccount() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => apiVoid("/api/account", { method: "DELETE", body: { password } }),
    onSuccess: () => {
      client.clear();
      client.setQueryData(queryKeys.session, null);
      navigate(paths.signIn(), { replace: true });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    remove.mutate();
  };
  return (
    <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3" noValidate>
      <TextField
        label="Your password"
        type="password"
        autoComplete="current-password"
        className="min-w-64 flex-1"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" variant="danger" busy={remove.isPending} disabled={!password}>
        Delete my account
      </Button>
      {remove.error && (
        <div className="w-full">
          <Alert>{errorText(remove.error)}</Alert>
        </div>
      )}
    </form>
  );
}

export function AccountPage() {
  const { user } = useSession();
  const preview = useQuery({
    queryKey: PREVIEW_KEY,
    queryFn: () => api("/api/account/deletion", AccountDeletionPreviewSchema),
  });
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <PageHeader title="Your account" description={user ? `${user.name} · ${user.email}` : ""} />
      {preview.isLoading ? (
        <Loading />
      ) : preview.error ? (
        <Alert>{errorText(preview.error)}</Alert>
      ) : (
        preview.data && (
          <>
            {preview.data.memberOf.length > 0 && (
              <Card>
                <h2 className="mb-2 text-base font-semibold text-stone-900">
                  Workspaces you belong to
                </h2>
                <ul className="divide-y divide-stone-100">
                  {preview.data.memberOf.map((w) => (
                    <li key={w.workspaceId} className="flex flex-wrap items-center gap-3 py-3">
                      <Link
                        to={paths.workspace(w.workspaceId)}
                        className="flex-1 text-sm text-indigo-700 hover:underline"
                      >
                        {w.name}
                      </Link>
                      <LeaveButton workspaceId={w.workspaceId} name={w.name} />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card>
              <h2 className="text-base font-semibold text-red-800">Delete your account</h2>
              {preview.data.owned.length > 0 && (
                <>
                  <p className="mt-1 text-sm text-stone-600">
                    These workspaces are yours and are deleted with everything in them; their
                    members lose access. Drafts and mail in your mailboxes stay there.
                  </p>
                  <ul aria-label="Workspaces deleted with your account" className="mt-3 text-sm">
                    {preview.data.owned.map((w) => (
                      <li key={w.workspaceId} className="py-1">
                        <span className="font-medium text-stone-900">{w.name}</span>
                        <span className="text-stone-600">
                          {w.members.length > 0
                            ? ` · shared with ${w.members.map((m) => m.name).join(", ")}`
                            : " · only you"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {preview.data.memberOf.length > 0 && (
                <p className="mt-3 text-sm text-stone-600">
                  You leave the workspaces you belong to; what you did there stays in their activity
                  log as "Deleted user".
                </p>
              )}
              <DeleteAccount />
            </Card>
          </>
        )
      )}
    </main>
  );
}
