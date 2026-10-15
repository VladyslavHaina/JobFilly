import { Navigate, useNavigate, useParams } from "react-router";
import { useWorkspace } from "../hooks";
import { AiForm } from "../pages/ai";
import { MailboxForm } from "../pages/mailbox";
import { ScanPage } from "../pages/scan";
import { type OnboardingStep, paths } from "../paths";
import { nextStep, ONBOARDING_STEPS } from "./steps";

/** /w/:workspaceId/setup/:step: Connect your mailbox → Pick your AI → Start scan. */
export function OnboardingPage() {
  const { workspaceId, workspace } = useWorkspace();
  const navigate = useNavigate();
  const { step: raw } = useParams();
  const step = ONBOARDING_STEPS.find((s) => s.id === raw);
  if (!step) return <Navigate to={paths.onboarding(workspaceId, "mailbox")} replace />;
  const index = ONBOARDING_STEPS.indexOf(step);
  const advance = (from: OnboardingStep) => {
    const next = nextStep(from);
    if (next) navigate(paths.onboarding(workspaceId, next));
  };
  return (
    <div className="mx-auto max-w-3xl">
      <ol aria-label="Setup steps" className="mb-8 flex flex-wrap gap-2 text-sm">
        {ONBOARDING_STEPS.map((s, i) => (
          <li
            key={s.id}
            aria-current={s.id === step.id ? "step" : undefined}
            className={`flex items-center gap-2 rounded-full px-3 py-1 ${
              s.id === step.id
                ? "bg-indigo-600 text-white"
                : i < index
                  ? "bg-indigo-50 text-indigo-800"
                  : "bg-stone-100 text-stone-500"
            }`}
          >
            <span aria-hidden>{i + 1}</span> {s.title}
          </li>
        ))}
      </ol>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-stone-900">{step.title}</h1>
      <p className="mb-6 text-sm text-stone-600">in {workspace.name}</p>
      {step.id === "mailbox" && (
        <MailboxForm
          workspaceId={workspaceId}
          mode="onboarding"
          onConnected={() => advance("mailbox")}
        />
      )}
      {step.id === "ai" && (
        <AiForm workspaceId={workspaceId} mode="onboarding" onSaved={() => advance("ai")} />
      )}
      {step.id === "scan" && <ScanPage workspaceId={workspaceId} />}
    </div>
  );
}
