import {
  type Rule,
  RuleChangeResultSchema,
  RuleListSchema,
  type RuleSource,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, apiVoid } from "../../api";
import { Alert, Button, Card, Loading, Switch } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";
import { changedText } from "../profile/changed";
import { RuleEditor, type RuleInput } from "./RuleEditor";

// The Rules list on the profile page (F3.1, F3.5): each rule in plain words with where it came
// from, switched on or off, and removed. From MVP 3 (F2.1) editors also make rules by hand and
// change a rule's conditions, action and words; each change says how many roles it changes
// (F2.3). Viewers see them with the controls disabled. A change re-scores the inbox within a
// minute; the scores show as being updated until then. The list sits in the "profiles" area, so
// profiles.updated refetches it everywhere.

interface RulesListProps {
  workspaceId: string;
  profileId: string;
}

const SOURCE_WORDS: Record<RuleSource, string> = {
  you: "Added by you",
  decision: "From a decision you answered",
  assistant: "From the assistant",
};

const rulesKey = (workspaceId: string, profileId: string) =>
  [...queryKeys.area(workspaceId, "profiles"), "rules", profileId] as const;

const rulesApi = (workspaceId: string, profileId: string) =>
  `${apiPaths.workspace(workspaceId)}/profiles/${encodeURIComponent(profileId)}/rules`;

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : "Something went wrong. Try again.";

/** Refetches the rules, the profile's history and the inbox after a change. */
function useRefresh(workspaceId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "profiles") }),
      client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "messages") }),
    ]);
}

function RuleRow(props: { rule: Rule; workspaceId: string; onChanged: (n: number) => void }) {
  const { rule, workspaceId, onChanged } = props;
  const { can } = useWorkspace();
  const refresh = useRefresh(workspaceId);
  const [editing, setEditing] = useState(false);
  const url = `${rulesApi(workspaceId, rule.profileId)}/${encodeURIComponent(rule.id)}`;
  const patch = useMutation({
    mutationFn: (body: Partial<RuleInput> & { enabled?: boolean }) =>
      api(url, RuleChangeResultSchema, { method: "PATCH", body }),
    onSuccess: async (updated) => {
      setEditing(false);
      onChanged(updated.changed);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => apiVoid(url, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const busy = patch.isPending || remove.isPending;
  if (editing) {
    return (
      <li className="py-3">
        <RuleEditor
          rule={rule}
          busy={patch.isPending}
          error={patch.error ? errorText(patch.error) : null}
          onSave={(input) => patch.mutate(input)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  const error = patch.error ?? remove.error;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm ${rule.enabled ? "text-stone-900" : "text-stone-500"}`}>
            {rule.description}
          </p>
          <p className="text-xs text-stone-500">
            {SOURCE_WORDS[rule.source]}
            {rule.enabled ? "" : " · Off"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Named by what it switches, so the name stays put when it flips; screen readers
              hear its state from aria-checked, and the word beside it shows that state. */}
          <Switch
            label={`Use the rule "${rule.description}"`}
            hideLabel
            checked={rule.enabled}
            disabled={!can.edit || busy}
            onChange={(enabled) => patch.mutate({ enabled })}
          />
          <span aria-hidden className="w-6 text-sm text-stone-800">
            {rule.enabled ? "On" : "Off"}
          </span>
          <Button
            variant="secondary"
            className="px-2.5 py-1 text-xs"
            disabled={!can.edit || busy}
            aria-label={`Change the rule "${rule.description}"`}
            onClick={() => setEditing(true)}
          >
            Change
          </Button>
          <Button
            variant="danger"
            className="px-2.5 py-1 text-xs"
            disabled={!can.edit || busy}
            aria-label={`Remove the rule "${rule.description}"`}
            onClick={() => remove.mutate()}
          >
            Remove
          </Button>
        </div>
      </div>
      {error && <Alert>{errorText(error)}</Alert>}
    </li>
  );
}

function NewRule(props: RulesListProps & { onChanged: (n: number) => void }) {
  const { workspaceId, profileId, onChanged } = props;
  const refresh = useRefresh(workspaceId);
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: (body: RuleInput) =>
      api(rulesApi(workspaceId, profileId), RuleChangeResultSchema, { method: "POST", body }),
    onSuccess: async (created) => {
      setOpen(false);
      onChanged(created.changed);
      await refresh();
    },
  });
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add a rule
      </Button>
    );
  }
  return (
    <RuleEditor
      busy={create.isPending}
      error={create.error ? errorText(create.error) : null}
      onSave={(input) => create.mutate(input)}
      onCancel={() => setOpen(false)}
    />
  );
}

export function RulesList({ workspaceId, profileId }: RulesListProps) {
  const { can } = useWorkspace();
  const [changed, setChanged] = useState<number | null>(null);
  const rules = useQuery({
    queryKey: rulesKey(workspaceId, profileId),
    queryFn: async () => (await api(rulesApi(workspaceId, profileId), RuleListSchema)).items,
  });
  return (
    <Card>
      <h2 className="text-base font-semibold text-stone-900">Rules</h2>
      <p className="mt-1 text-sm text-stone-600">
        What the app does with matching mail. A change re-scores your inbox within a minute.
        {can.edit ? "" : " Only editors and admins can change them."}
      </p>
      {changed !== null && (
        <div className="mt-3">
          <Alert tone="success">{changedText(changed)}</Alert>
        </div>
      )}
      <div className="mt-3">
        {rules.isPending && <Loading />}
        {rules.isError && <Alert>{errorText(rules.error)}</Alert>}
        {rules.data && rules.data.length === 0 && (
          <p className="text-sm text-stone-500">No rules yet. Ask the assistant to add one.</p>
        )}
        {rules.data && rules.data.length > 0 && (
          <ul aria-label="Rules" className="divide-y divide-stone-200">
            {rules.data.map((rule) => (
              <RuleRow key={rule.id} rule={rule} workspaceId={workspaceId} onChanged={setChanged} />
            ))}
          </ul>
        )}
      </div>
      {can.edit && (
        <div className="mt-3">
          <NewRule workspaceId={workspaceId} profileId={profileId} onChanged={setChanged} />
        </div>
      )}
    </Card>
  );
}
