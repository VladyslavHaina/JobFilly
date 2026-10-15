import {
  type ProfileHistoryItem,
  ProfileHistoryItemSchema,
  ProfileHistoryListSchema,
  type ProfileSource,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { Alert, Badge, Button, Card, Loading } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { formatFullDate } from "../inbox/format";
import { errorText, historyApi, historyKey } from "./queries";

// The profile history on the profile page (F8.4): every change to the profile's entries and
// rules, newest first, with who made it, when, where it came from and the words that led to it,
// before and after in plain words. Undo restores what the change touched and re-scores the inbox
// within a minute; only editors and admins can press it.

const SOURCE_WORDS: Record<ProfileSource, string> = {
  scan: "From the scan",
  you: "By hand",
  decision: "From a decision",
  assistant: "From the assistant",
};

function Entry({
  item,
  workspaceId,
  profileId,
}: {
  item: ProfileHistoryItem;
  workspaceId: string;
  profileId: string;
}) {
  const { can } = useWorkspace();
  const client = useQueryClient();
  const undo = useMutation({
    mutationFn: () =>
      api(
        `${historyApi(workspaceId, profileId)}/${encodeURIComponent(item.id)}/undo`,
        ProfileHistoryItemSchema,
        {
          method: "POST",
        },
      ),
    onSuccess: () =>
      Promise.all(
        (["profiles", "messages"] as const).map((area) =>
          client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, area) }),
        ),
      ),
  });
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="text-stone-900">
            <span className="font-medium">{item.byName ?? "A former member"}</span>
            {" · "}
            <time dateTime={item.at}>{formatFullDate(item.at)}</time>
            {" · "}
            {SOURCE_WORDS[item.source]}
          </p>
          {item.request && <p className="mt-0.5 text-stone-600">“{item.request}”</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.undoneAt ? (
            <Badge>Undone</Badge>
          ) : (
            <Button
              variant="secondary"
              className="px-2.5 py-1 text-xs"
              disabled={!can.edit}
              busy={undo.isPending}
              onClick={() => undo.mutate()}
            >
              Undo
            </Button>
          )}
        </div>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {item.lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines follow the change's fixed order
          <li key={i} className="text-stone-700">
            <span className="font-medium text-stone-800">{line.label}:</span>{" "}
            {line.before ?? (line.target === "rule" ? "no such rule" : "not set")} →{" "}
            {line.after ?? "removed"}
          </li>
        ))}
      </ul>
      {undo.isError && <Alert>{errorText(undo.error)}</Alert>}
    </li>
  );
}

interface ProfileHistoryProps {
  workspaceId: string;
  profileId: string;
}

export function ProfileHistory({ workspaceId, profileId }: ProfileHistoryProps) {
  const { can } = useWorkspace();
  const history = useQuery({
    queryKey: historyKey(workspaceId, profileId),
    queryFn: async () =>
      (await api(historyApi(workspaceId, profileId), ProfileHistoryListSchema)).items,
  });
  return (
    <Card>
      <h2 className="text-base font-semibold text-stone-900">History</h2>
      <p className="mt-1 text-sm text-stone-600">
        Every change to this profile and its rules. Undo brings back what a change replaced.
        {can.edit ? "" : " Only editors and admins can undo."}
      </p>
      <div className="mt-3">
        {history.isPending && <Loading />}
        {history.isError && <Alert>{errorText(history.error)}</Alert>}
        {history.data && history.data.length === 0 && (
          <p className="text-sm text-stone-500">No changes yet.</p>
        )}
        {history.data && history.data.length > 0 && (
          <ul aria-label="Profile history" className="divide-y divide-stone-200">
            {history.data.map((item) => (
              <Entry key={item.id} item={item} workspaceId={workspaceId} profileId={profileId} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
