import {
  type CreatedInvite,
  CreatedInviteSchema,
  InviteListSchema,
  type Member,
  MemberListSchema,
  type Role,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, api, apiVoid } from "../../api";
import { Alert, Button, Card, Loading, PageHeader, SelectField, TextField } from "../../components";
import { queryKeys, useSession, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";

const ROLES: { value: Role; label: string; help: string }[] = [
  { value: "viewer", label: "Viewer", help: "sees everything, changes nothing" },
  { value: "editor", label: "Editor", help: "also corrects categories and edits the profile" },
  { value: "admin", label: "Admin", help: "also manages members, the mailbox, AI and scans" },
];
const roleLabel = (role: Role) => ROLES.find((r) => r.value === role)?.label ?? role;

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : error ? "That didn't work. Try again." : null;

function MemberRow({ member, canManage }: { member: Member; canManage: boolean }) {
  const { workspaceId } = useWorkspace();
  const { user } = useSession();
  const client = useQueryClient();
  const refresh = () =>
    client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "workspace") });
  const changeRole = useMutation({
    mutationFn: (role: Role) =>
      api(`${apiPaths.workspace(workspaceId)}/members/${member.userId}`, MemberListSchema, {
        method: "PATCH",
        body: { role },
      }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () =>
      apiVoid(`${apiPaths.workspace(workspaceId)}/members/${member.userId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const editable = canManage && !member.isOwner;
  const error = errorText(changeRole.error ?? remove.error);
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium text-stone-900">
          {member.name}
          {member.userId === user?.id && <span className="ml-2 text-xs text-stone-500">(you)</span>}
          {member.isOwner && (
            <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
              Owner
            </span>
          )}
        </p>
        <p className="text-xs text-stone-500">{member.email}</p>
      </div>
      {editable ? (
        <>
          <SelectField
            label={`Role for ${member.name}`}
            className="[&>label]:sr-only"
            value={member.role}
            disabled={changeRole.isPending}
            onChange={(e) => changeRole.mutate(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </SelectField>
          <Button
            variant="danger"
            aria-label={`Remove ${member.name}`}
            busy={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Remove
          </Button>
        </>
      ) : (
        <span className="text-sm text-stone-700">{roleLabel(member.role)}</span>
      )}
      {error && (
        <div className="w-full">
          <Alert>{error}</Alert>
        </div>
      )}
    </li>
  );
}

function InviteForm() {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const invite = useMutation({
    mutationFn: () =>
      api(`${apiPaths.workspace(workspaceId)}/invites`, CreatedInviteSchema, {
        method: "POST",
        body: { email, role },
      }),
    onSuccess: (result) => {
      setCreated(result);
      setCopied(false);
      setEmail("");
      void client.invalidateQueries({ queryKey: queryKeys.invites(workspaceId) });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate();
  };
  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold text-stone-900">Invite someone</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
        <TextField
          label="Email"
          type="email"
          className="min-w-64 flex-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </SelectField>
        <Button type="submit" busy={invite.isPending} disabled={!email.trim()}>
          Send invite
        </Button>
      </form>
      <p className="mt-2 text-xs text-stone-500">
        {ROLES.map((r) => `${r.label}: ${r.help}`).join(" · ")}
      </p>
      {invite.error && (
        <div className="mt-4">
          <Alert>{errorText(invite.error)}</Alert>
        </div>
      )}
      {created && (
        <div className="mt-4">
          <Alert
            tone="success"
            title={`Invited ${created.invite.email} as ${roleLabel(created.invite.role)}`}
          >
            <p>They see the invitation after signing in. You can also send them this link:</p>
            <div className="mt-2 flex gap-2">
              <input
                readOnly
                aria-label="Invite link"
                value={created.link}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 rounded-md border border-emerald-300 bg-white px-2 py-1 font-mono text-xs"
              />
              <Button variant="secondary" onClick={copy}>
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          </Alert>
        </div>
      )}
    </Card>
  );
}

function PendingInvites() {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  const invites = useQuery({
    queryKey: queryKeys.invites(workspaceId),
    queryFn: async () =>
      (await api(`${apiPaths.workspace(workspaceId)}/invites`, InviteListSchema)).items,
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiVoid(`${apiPaths.workspace(workspaceId)}/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.invites(workspaceId) }),
  });
  const pending = invites.data?.filter((i) => i.status === "pending") ?? [];
  if (!pending.length) return null;
  return (
    <Card>
      <h2 className="mb-2 text-base font-semibold text-stone-900">Pending invites</h2>
      <ul className="divide-y divide-stone-100">
        {pending.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex-1">
              <p className="text-sm text-stone-900">{i.email}</p>
              <p className="text-xs text-stone-500">
                {roleLabel(i.role)} · expires {new Date(i.expiresAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="secondary"
              aria-label={`Revoke the invite for ${i.email}`}
              busy={revoke.isPending && revoke.variables === i.id}
              onClick={() => revoke.mutate(i.id)}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Members & invites: everyone sees the members; admins manage them and invite (F1.6, F1.8). */
export function MembersPage() {
  const { workspaceId, workspace, can } = useWorkspace();
  const members = useQuery({
    queryKey: queryKeys.members(workspaceId),
    queryFn: async () =>
      (await api(`${apiPaths.workspace(workspaceId)}/members`, MemberListSchema)).items,
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        description={`Who can open ${workspace.name}, and what they can do.`}
      />
      {can.admin && <InviteForm />}
      {can.admin && <PendingInvites />}
      <Card>
        <h2 className="mb-2 text-base font-semibold text-stone-900">People</h2>
        {members.isLoading ? (
          <Loading />
        ) : (
          <ul className="divide-y divide-stone-100">
            {members.data?.map((m) => (
              <MemberRow key={m.userId} member={m} canManage={can.admin} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
