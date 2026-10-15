import type { Decision, ProfileItem } from "@jobfilly/schema";
import { useId, useState } from "react";
import { Link } from "react-router";
import { Alert, Badge, Button, Card, Loading, PageHeader, TextField } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import {
  errorText,
  useAnswer,
  useDecisionCount,
  useDecisions,
  useDismiss,
  useNotNow,
} from "./queries";

// The decision inbox in the UI (F7): each question once, the messages waiting on it, answers to
// click plus a free-text option, and Use this answer for similar mail (F7.2); Not now and Don't
// ask for this message (F7.5); the open count in the navigation, kept live by decisions.updated
// events. Viewers see everything but can't answer (F7.7).

const OTHER = "other";

function DecisionCard({ decision }: { decision: Decision }) {
  const { workspaceId, can } = useWorkspace();
  const name = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [similar, setSimilar] = useState(true);
  const [kept, setKept] = useState(false);
  const answer = useAnswer(workspaceId, decision.id);
  const notNow = useNotNow(workspaceId, decision.id);
  const dismiss = useDismiss(workspaceId, decision.id);
  const value: ProfileItem | null =
    picked === OTHER
      ? text.trim() || null
      : picked === null
        ? null
        : (decision.choices[Number(picked)]?.value ?? null);
  const busy = answer.isPending || notNow.isPending || dismiss.isPending;
  const error = answer.error ?? notNow.error ?? dismiss.error;
  const n = decision.waiting.length;
  const locked = !can.edit || busy;

  return (
    <Card>
      <article aria-labelledby={`${name}-q`} className="flex flex-col gap-4">
        <h2 id={`${name}-q`} className="text-base font-semibold text-stone-900">
          {decision.question}
        </h2>

        <section aria-label="Waiting messages">
          <p className="text-sm text-stone-600">
            {n === 1 ? "1 message is waiting on this:" : `${n} messages are waiting on this:`}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {decision.waiting.map((w) => (
              <li
                key={`${w.messageId}#${w.position}`}
                className="flex flex-wrap items-center gap-2"
              >
                <Link
                  className="text-sm text-indigo-700 hover:underline"
                  to={paths.message(workspaceId, w.messageId)}
                >
                  {w.subject || "(no subject)"}
                </Link>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={locked}
                  aria-label={`Don't ask for this message: ${w.subject}`}
                  onClick={() => dismiss.mutate({ messageId: w.messageId, position: w.position })}
                >
                  Don't ask for this message
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (value !== null) answer.mutate({ value, useForSimilar: similar });
          }}
        >
          <fieldset className="flex flex-col gap-2" disabled={locked}>
            <legend className="text-sm font-medium text-stone-800">Your answer</legend>
            {decision.choices.map((choice, i) => (
              <label key={choice.label} className="flex items-center gap-2 text-sm text-stone-800">
                <input
                  type="radio"
                  name={name}
                  value={String(i)}
                  checked={picked === String(i)}
                  disabled={locked}
                  onChange={() => setPicked(String(i))}
                />
                {choice.label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm text-stone-800">
              <input
                type="radio"
                name={name}
                value={OTHER}
                checked={picked === OTHER}
                disabled={locked}
                onChange={() => setPicked(OTHER)}
              />
              Something else
            </label>
            {picked === OTHER && (
              <TextField
                label="Your answer in your own words"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
            {decision.profileKey !== null && (
              <label className="flex items-center gap-2 text-sm text-stone-800">
                <input
                  type="checkbox"
                  checked={similar}
                  disabled={locked}
                  onChange={(e) => setSimilar(e.target.checked)}
                />
                Use this answer for similar mail
              </label>
            )}
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!can.edit || value === null} busy={answer.isPending}>
              Answer
            </Button>
            <Button
              variant="secondary"
              disabled={locked}
              busy={notNow.isPending}
              onClick={() => notNow.mutate(undefined, { onSuccess: () => setKept(true) })}
            >
              Not now
            </Button>
            {!can.edit && (
              <span className="text-xs text-stone-500">
                Viewers can see decisions but can't answer them.
              </span>
            )}
          </div>
          {kept && <Alert tone="info">Kept for later. It stays here until you answer it.</Alert>}
          {error && <Alert>{errorText(error)}</Alert>}
        </form>
      </article>
    </Card>
  );
}

interface DecisionsPageProps {
  workspaceId: string;
}

export function DecisionsPage({ workspaceId }: DecisionsPageProps) {
  const decisions = useDecisions(workspaceId);
  return (
    <div>
      <PageHeader
        title="Decisions"
        description="Questions your profile and CVs don't answer. The replies waiting on them are written once you answer."
      />
      {decisions.isLoading && <Loading />}
      {decisions.error && <Alert>{errorText(decisions.error)}</Alert>}
      {decisions.data?.length === 0 && (
        <Card>
          <p className="text-sm text-stone-600">
            Nothing to decide. When a reply needs an answer your profile doesn't have, it waits
            here.
          </p>
        </Card>
      )}
      <ul className="flex flex-col gap-4">
        {decisions.data?.map((decision) => (
          <li key={decision.id}>
            <DecisionCard decision={decision} />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface DecisionCountProps {
  workspaceId: string;
}

export function DecisionCount({ workspaceId }: DecisionCountProps) {
  const count = useDecisionCount(workspaceId);
  const open = count.data ?? 0;
  if (open === 0) return null;
  return (
    <Badge tone="warning" label={open === 1 ? "1 open decision" : `${open} open decisions`}>
      {open}
    </Badge>
  );
}
