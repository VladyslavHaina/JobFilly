import { AiUsageListSchema, MailboxListSchema, type MailboxSyncStatus } from "@jobfilly/schema";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { Card, Loading } from "../../components";
import { queryKeys } from "../../hooks";
import { apiPaths } from "../../paths";

// Continuous sync in the UI (F1.4, F1.5): the mailbox status in the inbox header ("Synced 2
// minutes ago", "Can't reach the mail server since 10:42") and the model usage per day in
// Settings › AI. The status refetches on every mailbox.updated event (the "mailbox" live area)
// and its wording follows the clock; the usage refetches whenever messages were analysed (the
// "messages" area), which is when the sync and the scans call the model.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The time now, moving every `everyMs`, so "2 minutes ago" stays true while the page is open. */
function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** "just now", "2 minutes ago", "3 hours ago", "2 days ago". */
function agoText(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(iso));
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${plural(Math.floor(ms / MINUTE), "minute")} ago`;
  if (ms < DAY) return `${plural(Math.floor(ms / HOUR), "hour")} ago`;
  return `${plural(Math.floor(ms / DAY), "day")} ago`;
}

/** "10:42" in the browser's time zone, with the date when it wasn't today. */
function sinceText(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  if (at.toDateString() === now.toDateString()) return time;
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(at)}, ${time}`;
}

/** The status line of one mailbox, and a detail when the reason isn't the server being away. */
function statusText(sync: MailboxSyncStatus, now: Date): { line: string; detail: string | null } {
  if (sync.state === "failing" && sync.failingSince) {
    const away = sync.reason === null || sync.reason === "unreachable";
    return {
      line: `Can't reach the mail server since ${sinceText(sync.failingSince, now)}`,
      detail: away ? null : sync.message,
    };
  }
  if (sync.state === "ok" && sync.lastSyncedAt) {
    return { line: `Synced ${agoText(sync.lastSyncedAt, now)}`, detail: null };
  }
  return { line: "Waiting for the first sync", detail: null };
}

const statusKey = (workspaceId: string) =>
  [...queryKeys.area(workspaceId, "mailbox"), "status"] as const;

interface MailboxStatusProps {
  workspaceId: string;
}

/** The inbox header's mailbox status (F1.4); nothing while no mailbox is connected. */
export function MailboxStatus({ workspaceId }: MailboxStatusProps) {
  const now = useNow(30_000);
  const mailboxes = useQuery({
    queryKey: statusKey(workspaceId),
    queryFn: () => api(`${apiPaths.workspace(workspaceId)}/mailboxes`, MailboxListSchema),
  });
  const sync = mailboxes.data?.items[0]?.sync;
  if (!sync) return null;
  const { line, detail } = statusText(sync, now);
  const failing = sync.state === "failing";
  return (
    <div role="status" className="flex flex-col items-end text-right text-sm">
      <p className={failing ? "font-medium text-red-700" : "text-stone-600"}>
        <span
          aria-hidden="true"
          className={`mr-1.5 inline-block size-2 rounded-full ${
            failing ? "bg-red-600" : sync.state === "ok" ? "bg-emerald-500" : "bg-stone-400"
          }`}
        />
        {line}
      </p>
      {detail && <p className="text-xs text-stone-600">{detail}</p>}
      {failing && <p className="text-xs text-stone-500">It's tried again on its own.</p>}
    </div>
  );
}

interface UsagePerDayProps {
  workspaceId: string;
}

/** A UTC day ("2026-10-15") as the browser writes dates. */
function dayText(day: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/** Settings › AI: the workspace's model calls and tokens per day (F1.5). */
export function UsagePerDay({ workspaceId }: UsagePerDayProps) {
  const usage = useQuery({
    queryKey: [...queryKeys.area(workspaceId, "messages"), "ai-usage"],
    queryFn: () => api(`${apiPaths.workspace(workspaceId)}/ai/usage`, AiUsageListSchema),
  });
  const number = (n: number) => n.toLocaleString();
  return (
    <Card>
      <h2 className="text-base font-semibold text-stone-900">Model usage</h2>
      <p className="mt-1 text-sm text-stone-600">
        Calls to your AI provider and the tokens they used, per day (UTC), retries included.
      </p>
      <div className="mt-4">
        {usage.isLoading ? (
          <Loading />
        ) : usage.error ? (
          <p className="text-sm text-red-700">The usage couldn't be loaded. Try again.</p>
        ) : usage.data && usage.data.items.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-stone-500">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Day
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Model calls
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Tokens
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-stone-800">
              {usage.data.items.map((d) => (
                <tr key={d.day}>
                  <th scope="row" className="py-1.5 font-normal">
                    <time dateTime={d.day}>{dayText(d.day)}</time>
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{number(d.calls)}</td>
                  <td
                    className="py-1.5 text-right tabular-nums"
                    title={`${number(d.inputTokens)} in, ${number(d.outputTokens)} out`}
                  >
                    {number(d.inputTokens + d.outputTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-stone-600">No model calls yet.</p>
        )}
      </div>
    </Card>
  );
}
