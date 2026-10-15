import { MessageDetailSchema } from "@jobfilly/schema";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../../api";
import { queryKeys } from "../../hooks";
import { apiPaths, paths } from "../../paths";
import { formatListDate } from "../inbox/format";

// The evidence behind an answer (F6.2): a link per message to its page in the job inbox, the
// user's own replies included. Subjects load only when the list is opened.

const SHOWN_AT_FIRST = 10;

function EvidenceLink(props: { workspaceId: string; messageId: string; n: number }) {
  const { workspaceId, messageId, n } = props;
  // The same key as the inbox's message view, so opening the link shows it at once.
  const detail = useQuery({
    queryKey: [...queryKeys.area(workspaceId, "messages"), "detail", messageId],
    queryFn: () => api(apiPaths.message(workspaceId, messageId), MessageDetailSchema),
    retry: false,
  });
  const m = detail.data;
  return (
    <li>
      <Link
        to={paths.message(workspaceId, messageId)}
        className="text-sm text-indigo-700 hover:underline"
      >
        {m ? `${m.ownReply ? "Your reply: " : ""}${m.subject}` : `Email ${n}`}
      </Link>
      {m && <span className="ml-2 text-xs text-stone-500">{formatListDate(m.date)}</span>}
    </li>
  );
}

export function Evidence(props: { workspaceId: string; messageIds: string[]; label: string }) {
  const { workspaceId, messageIds, label } = props;
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  if (messageIds.length === 0) return null;
  const shown = all ? messageIds : messageIds.slice(0, SHOWN_AT_FIRST);
  const count = messageIds.length === 1 ? "the email" : `the ${messageIds.length} emails`;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-sm font-medium text-indigo-700 hover:underline"
      >
        {open ? `Hide ${count}` : `Show ${count}`}
      </button>
      {open && (
        <ul aria-label={`Evidence for ${label}`} className="mt-2 flex flex-col gap-1">
          {shown.map((id, i) => (
            <EvidenceLink key={id} workspaceId={workspaceId} messageId={id} n={i + 1} />
          ))}
          {!all && messageIds.length > SHOWN_AT_FIRST && (
            <li>
              <button
                type="button"
                onClick={() => setAll(true)}
                className="text-sm text-stone-600 hover:underline"
              >
                Show all {messageIds.length}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
