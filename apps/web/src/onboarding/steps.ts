import type { OnboardingStep } from "../paths";

/** The onboarding steps, in order: mailbox, then AI, then the first scan. */
export const ONBOARDING_STEPS: { id: OnboardingStep; title: string }[] = [
  { id: "mailbox", title: "Connect your mailbox" },
  { id: "ai", title: "Pick your AI" },
  { id: "scan", title: "Start scan" },
];

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.findIndex((s) => s.id === step);
  return ONBOARDING_STEPS[i + 1]?.id ?? null;
}
