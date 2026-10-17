import {
  type CreatedInvite,
  CreatedInviteSchema,
  InviteListSchema,
  type Member,
  MemberListSchema,
  type MemberScope,
  type Role,
  scopeOf,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError, api, apiVoid } from "../../api";
import {
  Alert,
  Button,
  Card,
  Dialog,
  Loading,
  PageHeader,
  SelectField,
  TextField,
} from "../../components";
import { queryKeys, useSession, useWorkspace } from "../../hooks";
import { apiPaths, paths } from "../../paths";

const ROLES: { value: Role; label: string; help: string }[] = [
  { value: "viewer", label: "Viewer", help: "sees everything, changes nothing" },
  { value: "editor", label: "Editor", help: "also corrects categories and edits the profile" },
  { value: "admin", label: "Admin", help: "also manages members, the mailbox, AI and scans" },
];
const roleLabel = (role: Role) => ROLES.find((r) => r.value === role)?.label ?? role;

/** What a member sees (MVP 3, F6.1). */
const SCOPES: { value: MemberScope; label: string }[] = [
  { value: "everything", label: "Everything" },
  { value: "pipeline", label: "Job pipeline only" },
];
const SCOPE_HELP =
  "Job pipeline only: roles, facts, matches, stages and the profile, but no message text, drafts or other mail.";
const scopeLabel = (scope: MemberScope) => SCOPES.find((s) => s.value === scope)?.label ?? scope;

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : error ? "That didn't work. Try again." : null;

function MemberRow({
  member,
  canManage,
  iAmOwner,
}: {
  member: Member;
  canManage: boolean;
  iAmOwner: boolean;
}) {
  const { workspaceId, workspace, can } = useWorkspace();
  const { user } = useSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [handingOver, setHandingOver] = useState(false);
  const path = `${apiPaths.workspace(workspaceId)}/members/${member.userId}`;
  const isMe = member.userId === user?.id;
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "workspace") }),
      client.invalidateQueries({ queryKey: queryKeys.workspaces }),
    ]);
  const change = useMutation({
    mutationFn: (body: { role?: Role; scope?: MemberScope }) =>
      api(path, MemberListSchema, { method: "PATCH", body }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => apiVoid(path, { method: "DELETE" }),
    onSuccess: async () => {
      if (!isMe) return refresh();
      // Leaving: this workspace is no longer the user's to see.
      await client.invalidateQueries({ queryKey: queryKeys.workspaces });
      navigate(paths.home(), { replace: true });
    },
  });
  const handOver = useMutation({
    mutationFn: () =>
      api(`${path}/ownership`, MemberListSchema, { method: "POST", body: { confirm: true } }),
    onSuccess: async () => {
      setHandingOver(false);
      await refresh();
    },
  });
  // Nobody changes their own role or what they see (the server refuses it too).
  const editable = canManage && !member.isOwner && !isMe;
  const error = errorText(change.error ?? remove.error ?? handOver.error);
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-48 flex-1">
        <p className="text-sm font-medium text-stone-900">
          {member.name}
          {isMe && <span className="ml-2 text-xs text-stone-500">(you)</span>}
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
            disabled={change.isPending}
            onChange={(e) => change.mutate({ role: e.target.value as Role })}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={`What ${member.name} sees`}
            className="[&>label]:sr-only"
            value={scopeOf(member)}
            disabled={change.isPending}
            onChange={(e) => change.mutate({ scope: e.target.value as MemberScope })}
          >
            {SCOPES.map((s) => (
              <option
                key={s.value}
                value={s.value}
                disabled={s.value === "everything" && !can.mail}
              >
                {s.label}
              </option>
            ))}
          </SelectField>
          {iAmOwner && member.role === "admin" && (
            <Button variant="secondary" onClick={() => setHandingOver(true)}>
              Make owner
            </Button>
          )}
          {!isMe && (
            <Button
              variant="danger"
              aria-label={`Remove ${member.name}`}
              busy={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remove
            </Button>
          )}
        </>
      ) : (
        <span className="text-sm text-stone-700">
          {roleLabel(member.role)} · {scopeLabel(scopeOf(member))}
        </span>
      )}
      {isMe && !member.isOwner && (
        <Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
          Leave workspace
        </Button>
      )}
      {error && (
        <div className="w-full">
          <Alert>{error}</Alert>
        </div>
      )}
      <Dialog
        title={`Hand ${workspace.name} over to ${member.name}?`}
        open={handingOver}
        onClose={() => setHandingOver(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setHandingOver(false)}>
              Cancel
            </Button>
            <Button busy={handOver.isPending} onClick={() => handOver.mutate()}>
              Make {member.name} the owner
            </Button>
          </>
        }
      >
        <p>
          {member.name} becomes the owner and always sees everything. You stay an admin, and they
          can hand it back.
        </p>
      </Dialog>
    </li>
  );
}

function InviteForm() {
  const { workspaceId, can } = useWorkspace();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  // An admin who sees the pipeline only can grant only that.
  const [scope, setScope] = useState<MemberScope>(can.mail ? "everything" : "pipeline");
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const invite = useMutation({
    mutationFn: () =>
      api(`${apiPaths.workspace(workspaceId)}/invites`, CreatedInviteSchema, {
        method: "POST",
        body: { email, role, scope },
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
        <SelectField
          label="Sees"
          value={scope}
          onChange={(e) => setScope(e.target.value as MemberScope)}
        >
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value} disabled={s.value === "everything" && !can.mail}>
              {s.label}
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
      <p className="mt-1 text-xs text-stone-500">{SCOPE_HELP}</p>
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
                {roleLabel(i.role)} · {scopeLabel(scopeOf(i))} · expires{" "}
                {new Date(i.expiresAt).toLocaleDateString()}
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

/**
 * Members & invites: everyone sees the members and can leave (but the owner); admins manage
 * them, choose what each sees, and invite; the owner hands the workspace to another admin (F1.6,
 * F1.8, MVP 3 F6.1, F6.3).
 */
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
        description={`Who can open ${workspace.name}, and what they can do and see.`}
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
              <MemberRow
                key={m.userId}
                member={m}
                canManage={can.admin}
                iAmOwner={workspace.isOwner}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
