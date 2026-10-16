import type { ReactNode } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router";
import { Button, Card, Loading } from "../components";
import {
  useLiveInvalidation,
  useSession,
  useSignOut,
  useWorkspace,
  useWorkspaces,
  WorkspaceProvider,
} from "../hooks";
import { AssistantLauncher } from "../pages/assistant";
import { DecisionCount } from "../pages/decisions";
import { PendingInvitations } from "../pages/invites";
import { paths } from "../paths";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

function Nav() {
  const { workspaceId, can } = useWorkspace();
  const links: { to: string; label: string; extra?: ReactNode }[] = [
    { to: paths.inbox(workspaceId), label: "Inbox" },
    { to: paths.drafts(workspaceId), label: "Drafts" },
    {
      to: paths.decisions(workspaceId),
      label: "Decisions",
      extra: <DecisionCount workspaceId={workspaceId} />,
    },
    { to: paths.scan(workspaceId), label: "Scan" },
    { to: paths.intake(workspaceId), label: "Intake" },
    { to: paths.profile(workspaceId), label: "Profile" },
    { to: paths.cvs(workspaceId), label: "CVs" },
    ...(can.admin
      ? [
          { to: paths.members(workspaceId), label: "Members" },
          { to: paths.settings(workspaceId, "mailbox"), label: "Settings" },
        ]
      : []),
  ];
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-1">
      {links.map((l) => (
        <NavLink
          key={l.label}
          to={l.to}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium ${
              isActive
                ? "bg-indigo-50 text-indigo-700"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`
          }
        >
          {l.label}
          {l.extra}
        </NavLink>
      ))}
    </nav>
  );
}

function Header() {
  const { user } = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="text-base font-semibold tracking-tight text-indigo-700">JobFilly</span>
        <WorkspaceSwitcher />
        <Nav />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-stone-600">{user?.name}</span>
          <Button
            variant="ghost"
            busy={signOut.isPending}
            onClick={() =>
              signOut.mutate(undefined, {
                onSettled: () => navigate(paths.signIn(), { replace: true }),
              })
            }
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}

function LiveUpdates() {
  const { workspaceId } = useWorkspace();
  useLiveInvalidation(workspaceId);
  return null;
}

/** /w/:workspaceId: the app shell around every page of one workspace. */
export function AppShell() {
  const { workspaceId } = useParams();
  const workspaces = useWorkspaces();
  // isPending, not isLoading: right after sign out the query is paused without data, and that
  // is no reason to say "Workspace not found".
  if (workspaces.isPending) {
    return (
      <main className="p-8">
        <Loading />
      </main>
    );
  }
  const workspace = workspaces.data?.find((w) => w.id === workspaceId);
  if (!workspace) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <Card>
          <h1 className="text-lg font-semibold text-stone-900">Workspace not found</h1>
          <p className="mt-2 text-sm text-stone-600">
            It doesn't exist, or you aren't a member of it.{" "}
            <NavLink className="text-indigo-700 hover:underline" to={paths.home()}>
              Go to your workspace
            </NavLink>
          </p>
        </Card>
      </main>
    );
  }
  return (
    <WorkspaceProvider workspace={workspace}>
      <LiveUpdates />
      <div className="min-h-screen bg-stone-50">
        <Header />
        <main className="mx-auto max-w-6xl px-4 py-6">
          <PendingInvitations />
          <Outlet />
        </main>
        {/* The assistant opens from every page (F8.1). */}
        <AssistantLauncher workspaceId={workspace.id} />
      </div>
    </WorkspaceProvider>
  );
}
