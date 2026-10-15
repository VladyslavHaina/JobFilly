import {
  type Address,
  type MessageListItem,
  type SenderCheck,
  type SenderMark,
  SenderMarkInputSchema,
  type SenderVerdict,
} from "@jobfilly/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api";
import { Alert, Badge, Button } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";

// The sender check in the UI (F5): a badge on each inbox row (looks fine, caution, high risk),
// and in the message detail the reasons, worded as estimates, a warning for a high-risk sender
// (no reply is drafted for it automatically, F5.2), and the Trusted and Blocked marks, which
// only editors set (F5.4).

const VERDICT: Record<SenderVerdict, { text: string; tone: "success" | "warning" | "danger" }> = {
  looks_fine: { text: "Looks fine", tone: "success" },
  caution: { text: "Caution", tone: "warning" },
  high_risk: { text: "High risk", tone: "danger" },
};

const verdictLabel = (verdict: SenderVerdict, complete: boolean) =>
  `Sender check: ${VERDICT[verdict].text}${complete ? "" : ", incomplete"}`;

export function SenderBadge({ sender }: { sender: MessageListItem["sender"] }) {
  if (!sender) return null;
  const { text, tone } = VERDICT[sender.verdict];
  return (
    <Badge tone={tone} label={verdictLabel(sender.verdict, sender.complete)}>
      {text}
    </Badge>
  );
}

function MarkButtons({ from, mark }: { from: Address; mark: SenderMark | null }) {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  const set = useMutation({
    mutationFn: (next: SenderMark | null) =>
      api(apiPaths.senderMarks(workspaceId), SenderMarkInputSchema, {
        method: "PUT",
        body: { scope: "address", value: from.address, mark: next },
      }),
    // The sender's mail is checked again; the inbox shows it when that is done.
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "messages") }),
  });
  const current = set.isSuccess ? set.variables : mark;
  const toggle = (which: SenderMark) => set.mutate(current === which ? null : which);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          aria-pressed={current === "trusted"}
          busy={set.isPending && set.variables === "trusted"}
          disabled={set.isPending}
          onClick={() => toggle("trusted")}
        >
          Trusted
        </Button>
        <Button
          variant="danger"
          aria-pressed={current === "blocked"}
          busy={set.isPending && set.variables === "blocked"}
          disabled={set.isPending}
          onClick={() => toggle("blocked")}
        >
          Blocked
        </Button>
      </div>
      <p className="text-xs text-stone-500">
        {current
          ? `Marked ${current} for every email from ${from.address}. Press it again to clear the mark.`
          : `Mark ${from.address} trusted or blocked for all its email.`}
      </p>
      {set.isError && (
        <Alert>
          {set.error instanceof ApiError ? set.error.message : "That didn't work. Try again."}
        </Alert>
      )}
    </div>
  );
}

export function SenderPanel(props: {
  workspaceId: string;
  messageId: string;
  from: Address;
  check: SenderCheck | null;
}) {
  const { from, check } = props;
  const { can } = useWorkspace();
  return (
    <section
      aria-label="Sender check"
      className="flex flex-col gap-2 border-t border-stone-200 pt-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-stone-700">Sender check</h3>
        {check && (
          <Badge
            tone={VERDICT[check.verdict].tone}
            label={verdictLabel(check.verdict, check.complete)}
          >
            {VERDICT[check.verdict].text}
          </Badge>
        )}
      </div>
      {!check && <p className="text-sm text-stone-500">Not checked yet.</p>}
      {check?.verdict === "high_risk" && (
        <Alert tone="error" title="This sender looks high risk">
          No reply is drafted for it automatically. Don't pay a fee or send ID documents to apply.
        </Alert>
      )}
      {check && (
        <>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-stone-700">
            {check.reasons.map((r, i) => (
              // Reasons may repeat a signal (two failed lookups); their order is the check's.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <li key={i}>{r.reason}</li>
            ))}
          </ul>
          <p className="text-xs text-stone-500">
            {check.complete
              ? "These are estimates from the email and its domain, not facts."
              : "These are estimates, and some checks couldn't be done, so the check is incomplete."}
          </p>
        </>
      )}
      {can.edit && <MarkButtons from={from} mark={check?.mark ?? null} />}
    </section>
  );
}
