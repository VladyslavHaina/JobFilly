import { NavLink, useParams } from "react-router";
import { PageHeader } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths, type SettingsTab } from "../../paths";
import { AiForm } from "../ai";
import { MailboxForm } from "../mailbox";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "mailbox", label: "Mailbox" },
  { id: "ai", label: "AI" },
];

/** Settings › Mailbox and Settings › AI, mounting the connect slice's forms in settings mode. */
export function SettingsPage() {
  const { workspaceId } = useWorkspace();
  const { tab } = useParams();
  const current: SettingsTab = tab === "ai" ? "ai" : "mailbox";
  return (
    <div>
      <PageHeader title="Settings" />
      <nav aria-label="Settings" className="mb-6 flex gap-1 border-b border-stone-200">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={paths.settings(workspaceId, t.id)}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                isActive || current === t.id
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-stone-600 hover:text-stone-900"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {current === "mailbox" ? (
        <MailboxForm workspaceId={workspaceId} mode="settings" />
      ) : (
        <AiForm workspaceId={workspaceId} mode="settings" />
      )}
    </div>
  );
}
