import type { AnalysisStatus, Category, CategorySource } from "@jobfilly/schema";
import { CATEGORY_LABELS } from "./format";

// The small labels of the job inbox: the category chip and the "Couldn't analyze" mark.

const CATEGORY_TONES: Record<Category, string> = {
  recruiter_outreach: "bg-sky-50 text-sky-800 ring-sky-200",
  job_alert: "bg-violet-50 text-violet-800 ring-violet-200",
  application_update: "bg-stone-100 text-stone-700 ring-stone-200",
  interview: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  assessment: "bg-teal-50 text-teal-800 ring-teal-200",
  offer: "bg-amber-50 text-amber-900 ring-amber-200",
  rejection: "bg-rose-50 text-rose-800 ring-rose-200",
  other_job: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  not_job: "bg-white text-stone-500 ring-stone-200",
};

const chip =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

export function CategoryChip({ category }: { category: Category }) {
  return <span className={`${chip} ${CATEGORY_TONES[category]}`}>{CATEGORY_LABELS[category]}</span>;
}

/**
 * Whether a message still shows as Couldn't analyze. A category a person set (F5.4) is the
 * answer the failed analysis didn't give, so from then on it reads as a corrected message.
 */
export const couldNotAnalyze = (m: {
  analysisStatus: AnalysisStatus;
  categorySource: CategorySource | null;
}) => m.analysisStatus === "failed" && m.categorySource !== "you";

export function CouldNotAnalyze() {
  return <span className={`${chip} bg-red-50 text-red-800 ring-red-200`}>Couldn't analyze</span>;
}

/**
 * Why a row says Couldn't analyze, and what to do about it. Nothing analyzes a failed message
 * again (Analyze them takes pending mail only), so the way on is setting the category by hand.
 */
export function CouldNotAnalyzeReason({ canEdit }: { canEdit: boolean }) {
  return (
    <span className="mt-1 block text-xs text-red-800">
      The AI's answer didn't fit, so nothing was guessed.{" "}
      {canEdit ? "Open it to set the category." : "Open it to read it."}
    </span>
  );
}
