import {
  type Category,
  JOB_CATEGORIES,
  type MessageListItem,
  MessageListSchema,
} from "@jobfilly/schema";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, api } from "../../api";
import { Alert, Button, Loading, PageHeader, TextField } from "../../components";
import { queryKeys } from "../../hooks";
import { apiPaths, paths } from "../../paths";
import { CategoryChip, CouldNotAnalyze } from "./badges";
import { CATEGORY_LABELS, formatListDate } from "./format";
import { MessageDetailView } from "./MessageDetail";

// The job inbox (F5): job mail newest first with category chips, filters, search and pages of
// 100; non-job mail behind a count and a Show toggle. A message opens on its deep link
// (paths.message), which is also how intake evidence links open the user's own replies; Esc
// goes back to the list.

const SEARCH_DELAY_MS = 250;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

interface Filters {
  category: Category | null;
  q: string;
  showNonJob: boolean;
  page: number;
}

function listUrl(workspaceId: string, f: Filters): string {
  const params = new URLSearchParams();
  if (f.category) params.set("category", f.category);
  if (f.q) params.set("q", f.q);
  if (f.showNonJob) params.set("showNonJob", "true");
  if (f.page > 1) params.set("page", String(f.page));
  const query = params.toString();
  return `${apiPaths.workspace(workspaceId)}/messages${query ? `?${query}` : ""}`;
}

function CategoryFilter(props: {
  value: Category | null;
  onChange: (category: Category | null) => void;
}) {
  const options: { value: Category | null; label: string }[] = [
    { value: null, label: "All" },
    ...JOB_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
  ];
  return (
    <fieldset className="flex flex-wrap gap-1.5">
      <legend className="sr-only">Filter by category</legend>
      {options.map((o) => {
        const active = props.value === o.value;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={active}
            onClick={() => props.onChange(o.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
              active
                ? "bg-indigo-600 text-white ring-indigo-600"
                : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}

function MessageRow(props: { workspaceId: string; message: MessageListItem; open: boolean }) {
  const { message: m } = props;
  return (
    <li>
      <Link
        to={paths.message(props.workspaceId, m.id)}
        data-message-id={m.id}
        aria-current={props.open ? "true" : undefined}
        className={`block px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 ${
          props.open ? "bg-indigo-50" : "hover:bg-stone-50"
        }`}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium text-stone-900">
            {m.from.name ?? m.from.address}
          </span>
          <time dateTime={m.date} className="shrink-0 text-xs text-stone-500">
            {formatListDate(m.date)}
          </time>
        </span>
        <span className="mt-0.5 block truncate text-sm text-stone-700">
          {m.subject || "(no subject)"}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {m.category && <CategoryChip category={m.category} />}
          {m.analysisStatus === "failed" && <CouldNotAnalyze />}
        </span>
      </Link>
    </li>
  );
}

export function InboxPage({
  workspaceId,
  messageId,
}: {
  workspaceId: string;
  messageId: string | null;
}) {
  const navigate = useNavigate();
  const [category, setCategory] = useState<Category | null>(null);
  const [search, setSearch] = useState("");
  const [showNonJob, setShowNonJob] = useState(false);
  const q = useDebounced(search.trim(), SEARCH_DELAY_MS);
  // The page belongs to one choice of filters: a new filter or search starts at the first page.
  const filterKey = JSON.stringify([category, q, showNonJob]);
  const [paging, setPaging] = useState({ filterKey, page: 1 });
  const page = paging.filterKey === filterKey ? paging.page : 1;
  const setPage = (n: number) => setPaging({ filterKey, page: n });
  const filters: Filters = { category, q, showNonJob, page };

  const list = useQuery({
    queryKey: [...queryKeys.area(workspaceId, "messages"), "list", filters],
    queryFn: () => api(listUrl(workspaceId, filters), MessageListSchema),
    placeholderData: keepPreviousData,
  });

  // Esc closes the open message (a select keeps Esc for its own popup).
  useEffect(() => {
    if (!messageId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof HTMLSelectElement) return;
      navigate(paths.inbox(workspaceId));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [messageId, workspaceId, navigate]);

  // Back on the list, focus returns to the message that was open.
  const listRef = useRef<HTMLUListElement>(null);
  const lastOpen = useRef<string | null>(null);
  useEffect(() => {
    if (messageId) {
      lastOpen.current = messageId;
      return;
    }
    const previous = lastOpen.current;
    lastOpen.current = null;
    if (!previous) return;
    const links = listRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [];
    for (const link of links) if (link.dataset.messageId === previous) link.focus();
  }, [messageId]);

  const data = list.data;
  const filtered = category !== null || q !== "";

  return (
    <div>
      <PageHeader title="Job inbox" description="Your job mail, newest first." />
      <div
        className={
          messageId ? "grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : "max-w-3xl"
        }
      >
        <div className={messageId ? "hidden min-w-0 lg:block" : "min-w-0"}>
          <div className="flex flex-col gap-3">
            <CategoryFilter value={category} onChange={setCategory} />
            <TextField
              label="Search sender or subject"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. a company or a recruiter"
            />
            {data && category === null && (
              <p className="flex items-center gap-2 text-sm text-stone-600">
                <span>
                  {data.nonJobCount === 1
                    ? "1 non-job email"
                    : `${data.nonJobCount} non-job emails`}{" "}
                  {showNonJob ? "shown" : "hidden"}
                </span>
                {data.nonJobCount > 0 && (
                  <Button
                    variant="secondary"
                    className="px-2.5 py-1 text-xs"
                    aria-pressed={showNonJob}
                    onClick={() => setShowNonJob((s) => !s)}
                  >
                    {showNonJob ? "Hide" : "Show"}
                  </Button>
                )}
              </p>
            )}
          </div>

          <div className="mt-4">
            {list.isPending && <Loading />}
            {list.isError && (
              <Alert>
                {list.error instanceof ApiError ? list.error.message : "Couldn't load the inbox."}
              </Alert>
            )}
            {data && data.items.length === 0 && (
              <p className="rounded-lg border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
                {filtered ? "No messages match." : "No job emails yet."}
              </p>
            )}
            {data && data.items.length > 0 && (
              <ul
                ref={listRef}
                aria-label="Messages"
                className="divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white"
              >
                {data.items.map((m) => (
                  <MessageRow
                    key={m.id}
                    workspaceId={workspaceId}
                    message={m}
                    open={m.id === messageId}
                  />
                ))}
              </ul>
            )}
            {data && (data.page > 1 || data.nextPage !== null) && (
              <nav aria-label="Pages" className="mt-3 flex items-center justify-between gap-3">
                <Button
                  variant="secondary"
                  disabled={data.page <= 1}
                  onClick={() => setPage(data.page - 1)}
                >
                  Newer
                </Button>
                <span className="text-sm text-stone-500">Page {data.page}</span>
                <Button
                  variant="secondary"
                  disabled={data.nextPage === null}
                  onClick={() => data.nextPage && setPage(data.nextPage)}
                >
                  Older
                </Button>
              </nav>
            )}
          </div>
        </div>
        {messageId && <MessageDetailView workspaceId={workspaceId} messageId={messageId} />}
      </div>
    </div>
  );
}
