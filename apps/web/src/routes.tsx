import type { ReactNode } from "react";
import { type RouteObject, useParams } from "react-router";
import { useWorkspace } from "./hooks";
import { AppShell, Home, NotFound, RequireSession, WorkspaceIndex } from "./layout";
import { OnboardingPage } from "./onboarding";
import { RegisterPage, SignInPage } from "./pages/auth";
import { InboxPage } from "./pages/inbox";
import { IntakePage } from "./pages/intake";
import { InvitationsPage, InviteLinkPage } from "./pages/invites";
import { MembersPage } from "./pages/members";
import { ProfilePage } from "./pages/profile";
import { ScanPage } from "./pages/scan";
import { NotAnalyzedBanner } from "./pages/scan/NotAnalyzedBanner";
import { SettingsPage } from "./pages/settings";

// Every page route of the app. URLs are built with paths.ts; keep the two in step.

/** The job inbox, on the list route (messageId null) and on the message deep link. */
function Inbox() {
  const { workspaceId } = useWorkspace();
  const { messageId } = useParams();
  return (
    <>
      <NotAnalyzedBanner workspaceId={workspaceId} />
      <InboxPage workspaceId={workspaceId} messageId={messageId ?? null} />
    </>
  );
}

function WorkspacePage({ page: Page }: { page: (props: { workspaceId: string }) => ReactNode }) {
  const { workspaceId } = useWorkspace();
  return <Page workspaceId={workspaceId} />;
}

export const routes: RouteObject[] = [
  { path: "/sign-in", element: <SignInPage /> },
  { path: "/register", element: <RegisterPage /> },
  {
    element: <RequireSession />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/invitations", element: <InvitationsPage /> },
      { path: "/invites/:inviteId", element: <InviteLinkPage /> },
      {
        path: "/w/:workspaceId",
        element: <AppShell />,
        children: [
          { index: true, element: <WorkspaceIndex /> },
          { path: "setup/:step", element: <OnboardingPage /> },
          { path: "inbox", element: <Inbox /> },
          { path: "inbox/:messageId", element: <Inbox /> },
          { path: "scan", element: <WorkspacePage page={ScanPage} /> },
          { path: "intake", element: <WorkspacePage page={IntakePage} /> },
          { path: "profile", element: <WorkspacePage page={ProfilePage} /> },
          { path: "members", element: <MembersPage /> },
          { path: "settings/:tab", element: <SettingsPage /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
];
