// Every in-app URL is built here, the one place that knows them. A message is named by its RFC
// Message-ID (angle brackets included), URL-encoded as one path segment.

export type SettingsTab = "mailbox" | "ai";
export type OnboardingStep = "mailbox" | "ai" | "scan";

const w = (workspaceId: string) => `/w/${encodeURIComponent(workspaceId)}`;

export const paths = {
  home: () => "/",
  signIn: (next?: string) => (next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"),
  register: (next?: string) => (next ? `/register?next=${encodeURIComponent(next)}` : "/register"),
  invitations: () => "/invitations",
  invite: (inviteId: string, token?: string) =>
    `/invites/${encodeURIComponent(inviteId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
  workspace: (workspaceId: string) => w(workspaceId),
  onboarding: (workspaceId: string, step: OnboardingStep = "mailbox") =>
    `${w(workspaceId)}/setup/${step}`,
  inbox: (workspaceId: string) => `${w(workspaceId)}/inbox`,
  message: (workspaceId: string, messageId: string) =>
    `${w(workspaceId)}/inbox/${encodeURIComponent(messageId)}`,
  scan: (workspaceId: string) => `${w(workspaceId)}/scan`,
  intake: (workspaceId: string) => `${w(workspaceId)}/intake`,
  cvs: (workspaceId: string) => `${w(workspaceId)}/cvs`,
  drafts: (workspaceId: string) => `${w(workspaceId)}/drafts`,
  decisions: (workspaceId: string) => `${w(workspaceId)}/decisions`,
  profile: (workspaceId: string) => `${w(workspaceId)}/profile`,
  members: (workspaceId: string) => `${w(workspaceId)}/members`,
  settings: (workspaceId: string, tab: SettingsTab = "mailbox") =>
    `${w(workspaceId)}/settings/${tab}`,
};

const api = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}`;

/** API paths of a workspace, for the pages' requests. */
export const apiPaths = {
  workspace: (workspaceId: string) => api(workspaceId),
  message: (workspaceId: string, messageId: string) =>
    `${api(workspaceId)}/messages/${encodeURIComponent(messageId)}`,
  cvs: (workspaceId: string) => `${api(workspaceId)}/cvs`,
  cv: (workspaceId: string, cvId: string) => `${api(workspaceId)}/cvs/${encodeURIComponent(cvId)}`,
  senderMarks: (workspaceId: string) => `${api(workspaceId)}/senders/marks`,
};
