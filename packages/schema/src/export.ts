import { z } from "zod";
import { IsoDateTimeSchema } from "./common";

// Your data (MVP 3, F7): the workspace as one streamed ZIP, deleting a workspace, deleting an
// account. Deleting removes everything the workspace holds in Postgres, credentials and CV files
// included; drafts and mail in the mailbox itself stay there.

/** Bumped when the layout of the export's JSON files changes. */
export const EXPORT_SCHEMA_VERSION = 1;

/**
 * The JSON parts of an export, one file each (`<part>.json`), plus the CV files under `cvs/` and
 * `manifest.json` (F7.1).
 */
export const EXPORT_PARTS = [
  "profiles",
  "rules",
  "cvs",
  "messages",
  "facts",
  "matches",
  "decisions",
  "drafts",
  "pipeline",
  "activity",
] as const;
export const ExportPartSchema = z.enum(EXPORT_PARTS);
export type ExportPart = z.infer<typeof ExportPartSchema>;

/** manifest.json of an export. */
export const ExportManifestSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  exportedAt: IsoDateTimeSchema,
  parts: z.array(ExportPartSchema),
  cvFiles: z.array(z.string()),
});
export type ExportManifest = z.infer<typeof ExportManifestSchema>;

/** DELETE /api/workspaces/:workspaceId (F7.2): the workspace's name, typed in. */
export const DeleteWorkspaceInputSchema = z.object({ name: z.string().min(1) });
export type DeleteWorkspaceInput = z.infer<typeof DeleteWorkspaceInputSchema>;

/**
 * GET /api/account/deletion (F7.3): the workspaces the user owns, with their members, which
 * deleting the account deletes; and the others, which the user just leaves.
 */
export const AccountDeletionPreviewSchema = z.object({
  owned: z.array(
    z.object({
      workspaceId: z.uuid(),
      name: z.string(),
      members: z.array(z.object({ userId: z.uuid(), name: z.string() })),
    }),
  ),
  memberOf: z.array(z.object({ workspaceId: z.uuid(), name: z.string() })),
});
export type AccountDeletionPreview = z.infer<typeof AccountDeletionPreviewSchema>;

/** DELETE /api/account: confirmed with the account's password. */
export const DeleteAccountInputSchema = z.object({ password: z.string().min(1) });
export type DeleteAccountInput = z.infer<typeof DeleteAccountInputSchema>;
