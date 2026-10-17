import { type ActivityEntry, ActivityListSchema } from "@jobfilly/schema";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, errorText } from "../../api";
import { Alert, Button, Card, Loading, PageHeader } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";

// The activity log (MVP 3, F9.1): who did which outward or sharing action, when. Admins only;
// newest first, a page at a time. Its query sits under the "workspace" area, so a member change
// refetches it.

function Entry({ entry }: { entry: ActivityEntry }) {
  const at = new Date(entry.at);
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
      <time dateTime={entry.at} className="w-40 shrink-0 text-xs text-stone-500">
        {at.toLocaleString()}
      </time>
      <span className="text-sm font-medium text-stone-900">{entry.actor?.name ?? "JobFilly"}</span>
      <span className="min-w-0 flex-1 text-sm text-stone-700">{entry.what}</span>
    </li>
  );
}

export function ActivityPage({ workspaceId }: { workspaceId: string }) {
  const { can } = useWorkspace();
  const log = useInfiniteQuery({
    queryKey: [...queryKeys.area(workspaceId, "workspace"), "activity"],
    queryFn: ({ pageParam }) =>
      api(
        `${apiPaths.workspace(workspaceId)}/activity${pageParam ? `?before=${pageParam}` : ""}`,
        ActivityListSchema,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled: can.admin,
  });
  const entries = log.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Activity"
        description="Drafts saved to the mailbox, mail sent, members invited, changed and removed, exports and deletions."
      />
      {!can.admin ? (
        <Alert tone="info">Only admins see the activity log.</Alert>
      ) : log.isLoading ? (
        <Loading />
      ) : log.error ? (
        <Alert>{errorText(log.error)}</Alert>
      ) : (
        <Card>
          {entries.length === 0 ? (
            <p className="text-sm text-stone-600">Nothing has happened yet.</p>
          ) : (
            <ul aria-label="Activity" className="divide-y divide-stone-100">
              {entries.map((e) => (
                <Entry key={e.id} entry={e} />
              ))}
            </ul>
          )}
          {log.hasNextPage && (
            <div className="mt-4">
              <Button
                variant="secondary"
                busy={log.isFetchingNextPage}
                onClick={() => log.fetchNextPage()}
              >
                Show older
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
