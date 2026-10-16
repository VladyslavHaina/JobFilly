import {
  type Address,
  type AnalysisStatus,
  type AppliedMark,
  AppliedSenderMarkSchema,
  type Category,
  JOB_CATEGORIES,
  type MessageListItem,
  type SenderCheck,
  type SenderMark,
  type SenderMarkInput,
  SenderMarkInputSchema,
  type SenderVerdict,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../api";
import { Alert, Badge, Button } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";

// The sender check in the UI (F5): a badge on each inbox row (looks fine, caution, high risk),
// and in the message detail the reasons, worded as estimates, a warning for a high-risk sender
// (no reply is drafted for it automatically, F5.2), and the Trusted and Blocked marks, which
// only editors set (F5.4). Only job mail is checked, once its analysis is done (packages/db,
// isJobMessage). Job mail without a stored check says "Not checked yet" in both places, never
// nothing, as a missing badge would read as nothing to worry about. Other mail (not job mail, or
// mail that couldn't be analyzed) is never checked, so it gets no badge and no promise of one.

const VERDICT: Record<SenderVerdict, { text: string; tone: "success" | "warning" | "danger" }> = {
  looks_fine: { text: "Looks fine", tone: "success" },
  caution: { text: "Caution", tone: "warning" },
  high_risk: { text: "High risk", tone: "danger" },
};

const verdictLabel = (verdict: SenderVerdict, complete: boolean) =>
  `Sender check: ${VERDICT[verdict].text}${complete ? "" : ", incomplete"}`;

const NOT_CHECKED = "Not checked yet";

function NotCheckedBadge() {
  return (
    <Badge tone="neutral" label={`Sender check: ${NOT_CHECKED}`}>
      {NOT_CHECKED}
    </Badge>
  );
}

/** What the badge and the panel know about a message: its category and its analysis. */
interface Mail {
  category: Category | null;
  analysisStatus: AnalysisStatus;
}

/** Job mail whose analysis is done or still to come: its sender is checked, or will be. */
const isCheckedMail = (m: Mail) =>
  m.analysisStatus !== "failed" &&
  m.category !== null &&
  (JOB_CATEGORIES as readonly Category[]).includes(m.category);

function VerdictBadge({ sender }: { sender: NonNullable<MessageListItem["sender"]> }) {
  const { text, tone } = VERDICT[sender.verdict];
  return (
    <Badge tone={tone} label={verdictLabel(sender.verdict, sender.complete)}>
      {text}
    </Badge>
  );
}

/**
 * The sender badge of an inbox row: the stored verdict, "Not checked yet" for job mail not
 * checked so far, and nothing for mail that is never checked.
 */
export function SenderBadge(props: Mail & { sender: MessageListItem["sender"] }) {
  if (props.sender) return <VerdictBadge sender={props.sender} />;
  return isCheckedMail(props) ? <NotCheckedBadge /> : null;
}

/** Why a message has no stored check: not yet (with the advice that holds until then), or never. */
function NoCheck(mail: Mail) {
  let text: string;
  if (isCheckedMail(mail)) {
    text =
      "Couldn't check this sender yet; it is checked when the email is analyzed. Until then, don't pay a fee or send ID documents to apply.";
  } else if (mail.analysisStatus === "failed") {
    text = "This sender isn't checked, as the email couldn't be analyzed.";
  } else {
    text = "Sender checks are for job mail only.";
  }
  return <p className="text-sm text-stone-500">{text}</p>;
}

const markedText = (m: AppliedMark | null, address: string) => {
  if (!m) return `Mark ${address} trusted or blocked for all its email.`;
  const button = m.mark === "trusted" ? "Trusted" : "Blocked";
  return m.scope === "domain"
    ? `Marked ${m.mark} for every email from the domain ${m.value}. Press ${button} again to clear it for the whole domain.`
    : `Marked ${m.mark} for every email from ${m.value}. Press it again to clear the mark.`;
};

/** The mark that applies to a message's sender now, as the server reads it back. */
function useAppliedMark(messageId: string, enabled = true) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    // Under the messages area, so a sender's re-done check refreshes its mark too. Asked by the
    // message, whose sender the server reads: an email address is never in a URL.
    queryKey: [...queryKeys.area(workspaceId, "messages"), "sender-mark", messageId],
    queryFn: async () =>
      (await api(apiPaths.messageSenderMark(workspaceId, messageId), AppliedSenderMarkSchema))
        .applied,
    enabled,
  });
}

/** The verdict a mark decides, as packages/core checkSender sets it (F5.4). */
const MARK_VERDICT: Record<SenderMark, SenderVerdict> = {
  trusted: "looks_fine",
  blocked: "high_risk",
};

/**
 * Trusted and Blocked. The pressed one is the mark that applies to the sender now, as the server
 * tells it (its address's own, or else its whole domain's), so pressing it again clears that very
 * mark; while a change is on its way, the one asked for.
 */
function MarkButtons({ messageId, from }: { messageId: string; from: Address }) {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  const messages = queryKeys.area(workspaceId, "messages");
  const address = from.address.toLowerCase();
  const applied = useAppliedMark(messageId);
  const set = useMutation({
    mutationFn: ({ input }: { press: SenderMark; input: SenderMarkInput }) =>
      api(apiPaths.senderMarks(workspaceId), SenderMarkInputSchema, { method: "PUT", body: input }),
    // The sender's mail is checked again; the inbox shows it when that is done. Pending until the
    // mark is read back, so the buttons never show a mark the server doesn't have.
    onSettled: () => client.invalidateQueries({ queryKey: messages }),
  });
  const standing = applied.data ?? null;
  const shown: AppliedMark | null = set.isPending
    ? set.variables.input.mark && { ...set.variables.input, mark: set.variables.input.mark }
    : standing;
  const press = (which: SenderMark) =>
    set.mutate({
      press: which,
      input:
        standing?.mark === which
          ? { scope: standing.scope, value: standing.value, mark: null }
          : { scope: "address", value: address, mark: which },
    });
  const ready = applied.isSuccess && !set.isPending;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          aria-pressed={shown?.mark === "trusted"}
          busy={set.isPending && set.variables.press === "trusted"}
          disabled={!ready}
          onClick={() => press("trusted")}
        >
          Trusted
        </Button>
        <Button
          variant="danger"
          aria-pressed={shown?.mark === "blocked"}
          busy={set.isPending && set.variables.press === "blocked"}
          disabled={!ready}
          onClick={() => press("blocked")}
        >
          Blocked
        </Button>
      </div>
      <p className="text-xs text-stone-500">{markedText(shown, from.address)}</p>
      {applied.isError && <Alert>Couldn't read this sender's mark. Reload to try again.</Alert>}
      {set.isError && (
        <Alert>
          {set.error instanceof ApiError ? set.error.message : "That didn't work. Try again."}
        </Alert>
      )}
    </div>
  );
}

export function SenderPanel(
  props: Mail & {
    workspaceId: string;
    messageId: string;
    from: Address;
    check: SenderCheck | null;
  },
) {
  const { from } = props;
  const { can } = useWorkspace();
  const applied = useAppliedMark(props.messageId, can.edit);
  // A saved mark re-does the check in the background (a sender-scoped re-evaluation), and the
  // new check arrives later with messages.updated. Meanwhile the stored check names another mark
  // than the one that applies now: the badge shows the verdict the new mark decides at once, or
  // that the check is being done again when the mark was cleared.
  const markNow = applied.isSuccess ? (applied.data?.mark ?? null) : undefined;
  const rechecking = props.check !== null && markNow !== undefined && markNow !== props.check.mark;
  const check: SenderCheck | null =
    props.check && rechecking && markNow
      ? { ...props.check, verdict: MARK_VERDICT[markNow], complete: true }
      : props.check;
  return (
    <section
      aria-label="Sender check"
      className="flex flex-col gap-2 border-t border-stone-200 pt-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-stone-700">Sender check</h3>
        {rechecking && !markNow ? (
          <Badge tone="neutral" label="Sender check: Checking again">
            Checking again
          </Badge>
        ) : (
          <SenderBadge
            sender={check}
            category={props.category}
            analysisStatus={props.analysisStatus}
          />
        )}
      </div>
      {rechecking && (
        <p className="text-sm text-stone-500">
          Checking this sender again with its new mark. The reasons below are from the last check.
        </p>
      )}
      {!check && <NoCheck category={props.category} analysisStatus={props.analysisStatus} />}
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
      {can.edit && <MarkButtons messageId={props.messageId} from={from} />}
    </section>
  );
}
