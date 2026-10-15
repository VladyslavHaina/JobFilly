// PostgreSQL storage through Drizzle. Workspace data is read and written only through the
// functions in ./queries, and every one of them takes a workspace id.

export { type Database, type DatabaseConnection, openDatabase, queryRows } from "./client";
export { MIGRATIONS_FOLDER } from "./migrate";
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
