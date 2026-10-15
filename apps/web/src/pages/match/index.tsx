import {
  CORE_PROFILE_LABELS,
  type CoreProfileKey,
  HARD_CONFLICT_CAP,
  isExtraKey,
  isPolicyKey,
  type MatchVerdict,
  type MessageListItem,
  POLICY_LABELS,
  type ProfileKey,
  type RoleEvaluation,
  type Verdict,
} from "@jobfilly/schema";
import { Badge } from "../../components";

// The explainable match in the UI (F3.4, F4): the fit score on each row (always called a "fit
// score"), the match panel per role in the message detail with every verdict and its reason, hard
// conflicts first, why a message is hidden, and the Hidden filter. A score a change made out of
// date is marked as being updated, never shown as current (F4.6).

interface FitScoreProps {
  fit: MessageListItem["fit"];
}

function scoreTone(score: number, capped: boolean) {
  if (capped) return "danger" as const;
  return score >= 70 ? ("success" as const) : ("neutral" as const);
}

/** The fit score chip of an inbox row; nothing until the message has one. */
export function FitScore({ fit }: FitScoreProps) {
  if (!fit) return null;
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

function entryLabel(key: ProfileKey): string {
  if (isPolicyKey(key)) return POLICY_LABELS[key];
  if (isExtraKey(key)) return key.slice("extra.".length).replace(/[-_]+/g, " ");
  return CORE_PROFILE_LABELS[key as CoreProfileKey];
}

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

/** One role's match: its fit score, every verdict with its reason, its skills and its rules. */
export function MatchPanel({ position, evaluation }: MatchPanelProps) {
  const heading = `Fit for role ${position + 1}`;
  if (!evaluation) {
    return (
      <section aria-label={heading} className="text-sm text-stone-500">
        Not scored yet.
      </section>
    );
  }
  const { match, hidden, ruleEffects, stale } = evaluation;
  // Hard conflicts first (F4.2), whatever order they come in.
  const verdicts = match ? [...match.verdicts].sort((a, b) => Number(b.hard) - Number(a.hard)) : [];
  const otherEffects = ruleEffects.filter((e) => e.action !== "hide" && e.action !== "cap_score");
  return (
    <section
      aria-label={heading}
      className="flex flex-col gap-3 rounded-md border border-stone-200 bg-stone-50 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {match ? (
          <FitScore fit={{ score: match.score, capped: match.capped, stale }} />
        ) : (
          <span className="text-sm text-stone-500">No fit score yet.</span>
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
      {otherEffects.length > 0 && (
        <ul aria-label="What your rules do" className="text-sm text-stone-700">
          {otherEffects.map((e) => (
            <li key={`${e.ruleId}-${e.action}`}>{e.reason}</li>
          ))}
        </ul>
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
