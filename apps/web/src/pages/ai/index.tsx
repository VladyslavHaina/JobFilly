// A stub with the name and props fixed by the foundation; the connect slice builds it.
export function AiForm(_props: {
  workspaceId: string;
  mode: "onboarding" | "settings";
  onSaved?: () => void;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-stone-900">AI provider</h2>
      <p className="mt-1 text-sm text-stone-600">Not available yet.</p>
    </section>
  );
}
