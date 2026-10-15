// A stub with the name and props fixed by the foundation; the connect slice builds it.
export function MailboxForm(_props: {
  workspaceId: string;
  mode: "onboarding" | "settings";
  onConnected?: () => void;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-stone-900">Mailbox</h2>
      <p className="mt-1 text-sm text-stone-600">Not available yet.</p>
    </section>
  );
}
