import { type Rule, RuleListSchema, RuleSchema, type RuleSource } from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, apiVoid } from "../../api";
import { Alert, Button, Card, Loading, Switch } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";

// The Rules list on the profile page (F3.1, F3.5): each rule in plain words with where it came
// from, switched on or off, and removed. Editors change them; viewers see them with the controls
// disabled. A change re-scores the inbox within a minute; the scores show as being updated until
// then. The list sits in the "profiles" area, so profiles.updated refetches it everywhere.

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

function RuleRow({ rule, workspaceId }: { rule: Rule; workspaceId: string }) {
  const { can } = useWorkspace();
  const client = useQueryClient();
  const url = `${rulesApi(workspaceId, rule.profileId)}/${encodeURIComponent(rule.id)}`;
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "profiles") }),
      client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "messages") }),
    ]);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api(url, RuleSchema, { method: "PATCH", body: { enabled } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => apiVoid(url, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const busy = toggle.isPending || remove.isPending;
  const error = toggle.error ?? remove.error;
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
            onChange={(enabled) => toggle.mutate(enabled)}
          />
          <span aria-hidden className="w-6 text-sm text-stone-800">
            {rule.enabled ? "On" : "Off"}
          </span>
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

export function RulesList({ workspaceId, profileId }: RulesListProps) {
  const { can } = useWorkspace();
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
      <div className="mt-3">
        {rules.isPending && <Loading />}
        {rules.isError && <Alert>{errorText(rules.error)}</Alert>}
        {rules.data && rules.data.length === 0 && (
          <p className="text-sm text-stone-500">No rules yet. Ask the assistant to add one.</p>
        )}
        {rules.data && rules.data.length > 0 && (
          <ul aria-label="Rules" className="divide-y divide-stone-200">
            {rules.data.map((rule) => (
              <RuleRow key={rule.id} rule={rule} workspaceId={workspaceId} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
