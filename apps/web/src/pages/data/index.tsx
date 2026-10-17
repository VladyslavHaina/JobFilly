import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { apiVoid, errorText } from "../../api";
import { Alert, Button, Card, TextField } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths, paths } from "../../paths";

// Settings › Data (MVP 3, F7.1, F7.2): download the workspace as a ZIP (admins who see
// everything), and delete it with its name typed in (the owner).

function ExportCard({ workspaceId }: { workspaceId: string }) {
  return (
    <Card>
      <h2 className="text-base font-semibold text-stone-900">Download your data</h2>
      <p className="mt-1 text-sm text-stone-600">
        One ZIP file with the profiles, rules, CVs and their files, message details, job facts,
        matches, decisions, drafts, the pipeline and the activity log. Passwords and keys are never
        in it.
      </p>
      <a
        href={`${apiPaths.workspace(workspaceId)}/export`}
        download
        className="mt-4 inline-flex rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Download ZIP
      </a>
    </Card>
  );
}

function DeleteCard({ workspaceId, name }: { workspaceId: string; name: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const remove = useMutation({
    mutationFn: () =>
      apiVoid(apiPaths.workspace(workspaceId), { method: "DELETE", body: { name: typed } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.workspaces });
      navigate(paths.home(), { replace: true });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    remove.mutate();
  };
  return (
    <Card>
      <h2 className="text-base font-semibold text-red-800">Delete this workspace</h2>
      <p className="mt-1 text-sm text-stone-600">
        This removes everything JobFilly keeps for {name}: the mailbox connection and its password,
        CVs and their files, profiles, rules, decisions, drafts, the activity log and every member's
        access. It can't be undone. Drafts and mail in your mailbox stay there.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3" noValidate>
        <TextField
          label={`Type ${name} to confirm`}
          className="min-w-64 flex-1"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <Button type="submit" variant="danger" busy={remove.isPending} disabled={typed !== name}>
          Delete workspace
        </Button>
      </form>
      {remove.error && (
        <div className="mt-4">
          <Alert>{errorText(remove.error)}</Alert>
        </div>
      )}
    </Card>
  );
}

export function DataSettings({ workspaceId }: { workspaceId: string }) {
  const { workspace, can } = useWorkspace();
  return (
    <div className="flex flex-col gap-6">
      {can.admin && can.mail ? (
        <ExportCard workspaceId={workspaceId} />
      ) : (
        <Alert tone="info">Admins who see everything can download the workspace's data.</Alert>
      )}
      {workspace.isOwner && <DeleteCard workspaceId={workspaceId} name={workspace.name} />}
    </div>
  );
}
