// PostgreSQL storage through Drizzle. Workspace data is read and written only through the
// functions in ./queries, and they take a workspace id, with two deliberate exceptions
// (ARCHITECTURE › Workspaces, access and sessions): the invitee answering an invite by its id
// (getInviteForResponse, acceptInvite, declineInvite), after the server has checked the invite's
// email or token, and the queue worker's lease operations on a job it claimed by id (claimJob,
// renewLease, saveJobCheckpoint, completeJob, handBackJob), which are guarded by the lease
// owner. There is no raw-SQL export.

export { type Database, type DatabaseConnection, openDatabase } from "./client";
export type { Notifier, Unlisten } from "./notify";
export * from "./queries/accounts";
export * from "./queries/ai-settings";
export * from "./queries/inbox";
export * from "./queries/invites";
export * from "./queries/jobs";
export * from "./queries/mailboxes";
export * from "./queries/messages";
export * from "./queries/profiles";
export * from "./queries/scans";
export * from "./queries/sessions";
export * from "./queries/usage";
export * from "./queries/workspaces";
