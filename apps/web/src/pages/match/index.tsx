import {
  entryLabel,
  HARD_CONFLICT_CAP,
  type ListFit,
  type MatchVerdict,
  type MessageListItem,
  type NoFitWhy,
  type RoleEvaluation,
  type Verdict,
} from "@jobfilly/schema";
import { Badge } from "../../components";

// The explainable match in the UI (F3.4, F4): the fit score on each row (always called a "fit
// score"), the match panel per role in the message detail with every verdict and its reason, hard
// conflicts first, why a message is hidden, and the Hidden filter. A score a change made out of
// date is marked as being updated, never shown as current (F4.6); a role not scored yet, or one
// that couldn't be scored, says so where its fit score would be.

interface FitScoreProps {
  fit: ListFit;
}

function scoreTone(score: number, capped: boolean) {
  if (capped) return "danger" as const;
  return score >= 70 ? ("success" as const) : ("neutral" as const);
}

/**
 * The fit score chip of an inbox row or a role: its score, or, for a job message whose roles have
 * none, "fit score pending" or "no fit score"; nothing when there is nothing to score.
 */
export function FitScore({ fit }: FitScoreProps) {
  if (!fit) return null;
  if (fit.score === null) return <NoFitChip why={fit.why} />;
  if (fit.stale) {
    return (
      <Badge tone="neutral" label={`Fit score ${fit.score}, out of date: being updated`}>
        <span className="text-stone-400 line-through">fit score {fit.score}</span>
        <span className="ml-1">updating…</span>
      </Badge>
    );
  }
  const capped = fit.capped ? `, capped at ${HARD_CONFLICT_CAP} by a conflict` : "";
  return (
    <Badge tone={scoreTone(fit.score, fit.capped)} label={`Fit score ${fit.score}${capped}`}>
      fit score {fit.score}
    </Badge>
  );
}

const VERDICT_WORDS: Record<Verdict, string> = {
  fits: "Fits",
  conflicts: "Conflicts",
  unknown: "Unknown",
};

const VERDICT_TONES: Record<Verdict, "success" | "danger" | "neutral"> = {
  fits: "success",
  conflicts: "danger",
  unknown: "neutral",
};

/** What a verdict is about: a profile entry, one of your rules, or the skills. */
function verdictSubject(v: MatchVerdict): string {
  if (v.ruleId) return "Your rule";
  if (v.entryKey) return entryLabel(v.entryKey);
  return "Skills";
}

function VerdictRow({ verdict }: { verdict: MatchVerdict }) {
  return (
    <li className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="flex shrink-0 items-center gap-2 sm:w-56">
        <Badge tone={VERDICT_TONES[verdict.verdict]}>
          {verdict.hard ? "Hard conflict" : VERDICT_WORDS[verdict.verdict]}
        </Badge>
        <span className="text-xs font-medium text-stone-600">{verdictSubject(verdict)}</span>
      </span>
      <span className="text-sm text-stone-800">{verdict.reason}</span>
    </li>
  );
}

function SkillList({ title, skills }: { title: string; skills: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-stone-600">{title}</p>
      <p className="text-sm text-stone-800">{skills.length > 0 ? skills.join(", ") : "None"}</p>
    </div>
  );
}

interface MatchPanelProps {
  workspaceId: string;
  messageId: string;
  position: number;
  /** Null until the role is evaluated. */
  evaluation: RoleEvaluation | null;
}

const NO_FIT: Record<NoFitWhy, { chip: string; label: string; words: string }> = {
  pending: {
    chip: "fit score pending",
    label: "Fit score pending",
    words: "This role hasn't been scored yet; its fit score shows here soon.",
  },
  unscored: {
    chip: "no fit score",
    label: "No fit score",
    words: "This role couldn't be scored, so it has no fit score.",
  },
};

/** The chip where a fit score would be, when there is none: pending, or couldn't be scored. */
function NoFitChip({ why }: { why: NoFitWhy }) {
  return (
    <Badge tone="neutral" label={NO_FIT[why].label}>
      {NO_FIT[why].chip}
    </Badge>
  );
}

/** A role's missing fit score in the match panel: the chip and what it means. */
function NoFitScore({ why }: { why: NoFitWhy }) {
  return (
    <>
      <NoFitChip why={why} />
      <span className="text-sm text-stone-500">{NO_FIT[why].words}</span>
    </>
  );
}

/** One role's match: its fit score, every verdict with its reason (rules included), its skills. */
export function MatchPanel({ position, evaluation }: MatchPanelProps) {
  const heading = `Fit for role ${position + 1}`;
  if (!evaluation) {
    return (
      <section
        aria-label={heading}
        className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-stone-50 p-3"
      >
        <NoFitScore why="pending" />
      </section>
    );
  }
  // The rules that apply are among the verdicts, each naming its rule (F3.3).
  const { match, hidden, stale } = evaluation;
  // Hard conflicts first (F4.2), whatever order they come in.
  const verdicts = match ? [...match.verdicts].sort((a, b) => Number(b.hard) - Number(a.hard)) : [];
  return (
    <section
      aria-label={heading}
      className="flex flex-col gap-3 rounded-md border border-stone-200 bg-stone-50 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {match ? (
          <FitScore fit={{ score: match.score, capped: match.capped, stale }} />
        ) : (
          <NoFitScore why={stale ? "pending" : "unscored"} />
        )}
        {match?.capped && (
          <span className="text-xs text-stone-600">
            Capped at {HARD_CONFLICT_CAP}: a hard conflict
          </span>
        )}
      </div>
      {stale && (
        <p role="status" className="text-xs text-amber-900">
          Your profile or rules changed; this score is being updated.
        </p>
      )}
      {hidden && <p className="text-sm text-stone-700">{hidden.reason}</p>}
      {verdicts.length > 0 && (
        <ul aria-label="Why this fit score" className="divide-y divide-stone-200">
          {verdicts.map((v, i) => (
            // A verdict has no id; the list is replaced whole when the role is scored again.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <VerdictRow key={i} verdict={v} />
          ))}
        </ul>
      )}
      {match && (
        <div className="grid gap-2 sm:grid-cols-2">
          <SkillList title="Skills you have" skills={match.skills.matched} />
          <SkillList title="Skills missing" skills={match.skills.missing} />
        </div>
      )}
    </section>
  );
}

interface HiddenReasonProps {
  hidden: MessageListItem["hidden"];
}

/** Why a message is hidden, naming the rule: "Hidden by your rule …" (F3.3). */
export function HiddenReason({ hidden }: HiddenReasonProps) {
  if (!hidden) return null;
  return <span className="text-xs text-stone-600">{hidden.reason}</span>;
}

/** The Hidden filter of the inbox: `value` true lists only hidden messages. */
interface HiddenFilterProps {
  value: boolean;
  onChange: (value: boolean) => void;
}

export function HiddenFilter({ value, onChange }: HiddenFilterProps) {
  return (
    <div>
      <button
        type="button"
        aria-pressed={value}
        onClick={() => onChange(!value)}
        className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
          value
            ? "bg-stone-700 text-white ring-stone-700"
            : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50"
        }`}
      >
        Hidden
      </button>
      {value && (
        <span className="ml-2 text-xs text-stone-600">
          Showing only mail your rules hide, with the rule that hides it.
        </span>
      )}
    </div>
  );
}
