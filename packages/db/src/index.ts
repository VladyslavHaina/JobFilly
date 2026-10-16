// PostgreSQL storage through Drizzle. Workspace data is read and written only through the
// functions in ./queries, and they take a workspace id, with three deliberate exceptions
// (ARCHITECTURE › Workspaces, access and sessions): the invitee answering an invite by its id
// (getInviteForResponse, acceptInvite, declineInvite), after the server has checked the invite's
// email or token; the queue worker's lease operations on a job it claimed by id (claimJob,
// renewLease, saveJobCheckpoint, completeJob, handBackJob), which are guarded by the lease
// owner; and the signed-in user's own view across workspaces (listWorkspacesForUser by user id,
// listPendingInvitations by the email the server matched to them). Three cross-workspace reads
// serve every workspace the way the job claim does: listWorkspacesWithWork and
// listWorkspacesWithFailedLookups (the pipeline sweep) and listMailboxesToSync (the sync
// scheduler's mailbox listing); each only finds the workspaces to work on. registerAccount and
// createWorkspace make a workspace, so they have no id to take yet. There is no raw-SQL export.

export { type Database, type DatabaseConnection, openDatabase } from "./client";
export type { Notifier, Unlisten } from "./notify";
export * from "./queries/accounts";
export * from "./queries/ai-settings";
export * from "./queries/assistant";
export * from "./queries/cvs";
export * from "./queries/decisions";
export * from "./queries/draft-claims";
export * from "./queries/drafts";
export * from "./queries/evaluations";
export * from "./queries/inbox";
export * from "./queries/invites";
export * from "./queries/jobs";
export * from "./queries/mailboxes";
export * from "./queries/match";
export * from "./queries/messages";
export * from "./queries/profile-changes";
export * from "./queries/profiles";
export * from "./queries/rules";
export * from "./queries/scans";
export * from "./queries/senders";
export * from "./queries/sessions";
export {
  type BackOff,
  clearStageFailure,
  clearStageFailures,
  type FailedStage,
  getStageHolds,
  recordStageFailure,
  type StageHolds,
} from "./queries/stage-failures";
export * from "./queries/sync";
export * from "./queries/usage";
export * from "./queries/workspaces";
