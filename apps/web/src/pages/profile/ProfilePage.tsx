import {
  type Profile,
  ProfileChangeResultSchema,
  type ProfileEntry,
  type ProfileKey,
  type ProfileValue,
} from "@jobfilly/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError, api } from "../../api";
import {
  Alert,
  Button,
  Card,
  Loading,
  PageHeader,
  SelectField,
  Switch,
  TextField,
} from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { ProfileHistory } from "../assistant";
import { ProfileCvPrompt } from "../cvs";
import { formatFullDate } from "../inbox/format";
import { AnswerEditor } from "../intake/answers";
import { Evidence } from "../intake/Evidence";
import { profilesApi, profilesKey, useFormOpen, useProfiles } from "../intake/queries";
import { ScanFirst } from "../intake/ScanFirst";
import { RulesList } from "../rules";
import { RerunSetup } from "../scan/RerunSetup";
import { changedText } from "./changed";

// The confirmed profile (F6.5): every entry with where it came from — the scan, or you — and a
// name that can be changed. Editors change answers with the same clicks as the intake form;
// viewers see it all, disabled (F6.7).
//
// MVP 3: with several profiles (F1.1) a switcher picks the one shown (?profile=<id>), each is
// switched on or off (F1.2; the server keeps one on), and a changed answer says how many of the
// profile's roles it changes (F2.3).

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : "That didn't work. Try again.";

const SOURCES: Record<ProfileEntry["source"], { text: string; tone: string }> = {
  scan: { text: "From the scan", tone: "bg-stone-100 text-stone-700 ring-stone-200" },
  you: { text: "Set by you", tone: "bg-indigo-50 text-indigo-800 ring-indigo-200" },
  decision: { text: "From a decision", tone: "bg-amber-50 text-amber-900 ring-amber-200" },
  assistant: {
    text: "From the assistant",
    tone: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  },
};

function Source({ entry }: { entry: ProfileEntry }) {
  const { text, tone } = SOURCES[entry.source];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
    >
      {text}
    </span>
  );
}

function useUpdateProfile(profile: Profile) {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: {
      name?: string;
      enabled?: boolean;
      entries?: { key: ProfileKey; value: ProfileValue }[];
    }) =>
      api(
        `${profilesApi(workspaceId)}/${encodeURIComponent(profile.id)}`,
        ProfileChangeResultSchema,
        { method: "PATCH", body: patch },
      ),
    onSuccess: ({ changed: _changed, ...updated }, patch) => {
      client.setQueryData<Profile[]>(profilesKey(workspaceId), (current) =>
        current?.map((p) => (p.id === updated.id ? updated : p)),
      );
      // Switching a profile on or off moves roles between profiles.
      if (patch.enabled !== undefined) {
        void client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "messages") });
      }
    },
  });
}

/** Whether roles go to this profile (F1.2). */
function OnOff({ profile }: { profile: Profile }) {
  const { can } = useWorkspace();
  const update = useUpdateProfile(profile);
  const on = profile.enabled !== false;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Switch
          label="Give roles to this profile"
          checked={on}
          disabled={!can.edit || update.isPending}
          onChange={(enabled) => update.mutate({ enabled })}
        />
        <span className="text-sm text-stone-600">{on ? "On" : "Off: it gets no roles"}</span>
      </div>
      {update.error && <Alert>{errorText(update.error)}</Alert>}
    </div>
  );
}

/** Which profile the page shows, when there are several (F1.1). */
function Switcher(props: {
  profiles: Profile[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <SelectField
      label="Profile"
      value={props.selected}
      onChange={(e) => props.onSelect(e.target.value)}
      className="max-w-xs"
    >
      {props.profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.enabled === false ? `${p.name} (off)` : p.name}
        </option>
      ))}
    </SelectField>
  );
}

function Rename({ profile }: { profile: Profile }) {
  const { can } = useWorkspace();
  const update = useUpdateProfile(profile);
  const [name, setName] = useState<string | null>(null);
  if (name === null) {
    return (
      <Button variant="secondary" disabled={!can.edit} onClick={() => setName(profile.name)}>
        Rename
      </Button>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    update.mutate({ name: name.trim() }, { onSuccess: () => setName(null) });
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <TextField
        label="Profile name"
        value={name}
        maxLength={100}
        autoFocus
        error={update.error ? errorText(update.error) : null}
        onChange={(e) => setName(e.target.value)}
      />
      <Button type="submit" busy={update.isPending} disabled={!name.trim()}>
        Save
      </Button>
      <Button variant="ghost" onClick={() => setName(null)}>
        Cancel
      </Button>
    </form>
  );
}

function Entries({ profile }: { profile: Profile }) {
  const { workspaceId, can } = useWorkspace();
  const update = useUpdateProfile(profile);
  return (
    <div className="flex flex-col gap-4">
      {update.error && <Alert>{errorText(update.error)}</Alert>}
      {update.data && update.variables?.entries && (
        <Alert tone="success">{changedText(update.data.changed)}</Alert>
      )}
      {profile.entries.map((entry) => (
        <section
          key={entry.key}
          aria-label={entry.label}
          className="rounded-lg border border-stone-200 bg-white p-5 shadow-xs"
        >
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-stone-900">{entry.label}</h2>
            <Source entry={entry} />
            <span className="text-xs text-stone-500">
              Updated {formatFullDate(entry.updatedAt)}
            </span>
          </header>
          {entry.value.length === 0 && (
            <p className="mt-1 text-sm text-stone-500 italic">No answer yet.</p>
          )}
          <div className="mt-3">
            <AnswerEditor
              entryKey={entry.key}
              label={entry.label}
              value={entry.value}
              disabled={!can.edit || update.isPending}
              onChange={(value) => update.mutate({ entries: [{ key: entry.key, value }] })}
            />
          </div>
          <div className="mt-3">
            <Evidence
              workspaceId={workspaceId}
              messageIds={entry.evidence.map((e) => e.messageId)}
              label={entry.label}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Why there is no profile yet, and the next step: the first scan has to stop before the intake
 * form fills itself in, and confirming that form, which an editor or admin does, saves it.
 */
function NoProfileYet({ workspaceId }: { workspaceId: string }) {
  const { can } = useWorkspace();
  const gate = useFormOpen(workspaceId);
  let body: ReactNode;
  if (gate.pending) body = null;
  else if (!gate.open) {
    body = (
      <>
        No profile yet. It is saved when the intake form is confirmed, and the form fills itself in
        once the first scan has stopped.{" "}
        <ScanFirst workspaceId={workspaceId} firstScan={gate.firstScan} />
      </>
    );
  } else {
    body = (
      <>
        {can.edit
          ? "No profile yet. Check the answers on the intake form and confirm them to save it."
          : "No profile yet. It is saved when an editor or admin confirms the intake form."}{" "}
        <Link className="font-medium underline" to={paths.intake(workspaceId)}>
          {can.edit ? "Open the intake form" : "See the intake form"}
        </Link>
      </>
    );
  }
  return (
    <section>
      <PageHeader title="Profile" />
      {body ? (
        <Card>
          <p className="text-sm text-stone-700">{body}</p>
        </Card>
      ) : (
        <Loading />
      )}
    </section>
  );
}

export function ProfilePage({ workspaceId }: { workspaceId: string }) {
  const { can } = useWorkspace();
  const profiles = useProfiles(workspaceId);
  const [search, setSearch] = useSearchParams();
  if (profiles.isPending) return <Loading />;
  if (profiles.isError) return <Alert>{errorText(profiles.error)}</Alert>;
  const profile = profiles.data.find((p) => p.id === search.get("profile")) ?? profiles.data[0];
  if (!profile) return <NoProfileYet workspaceId={workspaceId} />;
  return (
    <section>
      <PageHeader
        title={profile.name}
        description={
          profile.confirmedAt ? `Confirmed ${formatFullDate(profile.confirmedAt)}` : undefined
        }
        actions={<Rename key={profile.id} profile={profile} />}
      />
      {!can.edit && (
        <div className="mb-4">
          <Alert tone="info">You can see the profile; only editors and admins can change it.</Alert>
        </div>
      )}
      <RerunSetup workspaceId={workspaceId} />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        {profiles.data.length > 1 && (
          <Switcher
            profiles={profiles.data}
            selected={profile.id}
            onSelect={(id) => setSearch({ profile: id })}
          />
        )}
        {/* Keyed by the profile, so the switch's state never carries over to another one. */}
        <OnOff key={profile.id} profile={profile} />
      </div>
      <div className="mb-4">
        <ProfileCvPrompt workspaceId={workspaceId} profileId={profile.id} />
      </div>
      <Entries key={profile.id} profile={profile} />
      <div className="mt-6 flex flex-col gap-6">
        <RulesList workspaceId={workspaceId} profileId={profile.id} />
        <ProfileHistory workspaceId={workspaceId} profileId={profile.id} />
      </div>
    </section>
  );
}
