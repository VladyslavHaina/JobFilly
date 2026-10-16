import { z } from "zod";
import { IsoDateTimeSchema, TextSchema } from "./common";

// CVs (F2): the files a workspace uploads, what cv.v1 read from them, the user's tags, and the
// CV the app would use for each role.

/** The largest CV file accepted (F2, the cvs table checks it too). */
export const MAX_CV_BYTES = 5 * 1024 * 1024;

export const CvMediaTypeSchema = z.enum(["pdf", "docx"]);
export type CvMediaType = z.infer<typeof CvMediaTypeSchema>;

/** The MIME type of each CV media type, for uploads and downloads. */
export const CV_MIME_TYPES: Record<CvMediaType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** A tag on a CV: suggested by the AI from what it read, or added by a person (F2.1). */
export const CvTagSchema = z.object({
  label: TextSchema.trim().min(1).max(60),
  source: z.enum(["ai", "you"]),
});
export type CvTag = z.infer<typeof CvTagSchema>;

/** pending until cv.v1 has read the file; failed when it couldn't be read. */
export const CvReadStatusSchema = z.enum(["pending", "done", "failed"]);
export type CvReadStatus = z.infer<typeof CvReadStatusSchema>;

/** A CV as the API returns it; never its text or bytes (GET /cvs/:cvId/file downloads it). */
export const CvSchema = z.object({
  id: z.uuid(),
  name: TextSchema.min(1).max(100),
  fileName: z.string(),
  mediaType: CvMediaTypeSchema,
  sizeBytes: z.number().int().nonnegative().max(MAX_CV_BYTES),
  /** SHA-256 of the file's bytes, lower-case hex: the key of cv.v1 (CV-SHA256 line). */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** What cv.v1 read; null and [] until it has. Skills only as the CV text writes them (F2.2). */
  language: z.string().nullable(),
  skills: z.array(z.string()),
  roleFamilies: z.array(z.string()),
  seniority: z.string().nullable(),
  countryHints: z.array(z.string()),
  formatHints: z.array(z.string()),
  tags: z.array(CvTagSchema),
  /**
   * The CV to use when nothing else in a role tells the CVs apart (F2.3): set by the user, a
   * flag rather than a tag's words, so it means the same in every language.
   */
  preferred: z.boolean(),
  readStatus: CvReadStatusSchema,
  uploadedAt: IsoDateTimeSchema,
});
export type Cv = z.infer<typeof CvSchema>;

export const CvListSchema = z.object({ items: z.array(CvSchema) });
export type CvList = z.infer<typeof CvListSchema>;

/** The multipart field of POST /cvs that carries the file; `name` is an optional text field. */
export const CV_UPLOAD_FILE_FIELD = "file";
export const CvUploadFieldsSchema = z.object({
  name: TextSchema.trim().min(1).max(100).optional(),
});

/** A skill or a format hint as the user edits it: one short label. */
const CvLabelSchema = TextSchema.trim().min(1).max(100);

/**
 * PATCH /cvs/:cvId: what the user leaves of what the AI suggested, and what they add (F2.1), as
 * editable tags: the tags (AI tags kept or removed, own added), the skills (removed, or added
 * when the CV's text contains them, F2.2) and the format hints; and whether it is the preferred
 * CV. Each list replaces the CV's; a field left out stays as it is, and at least one is given.
 */
export const CvUpdateSchema = z
  .object({
    tags: z.array(CvTagSchema).max(50).optional(),
    skills: z.array(CvLabelSchema).max(100).optional(),
    formatHints: z.array(CvLabelSchema).max(20).optional(),
    preferred: z.boolean().optional(),
  })
  .refine((u) => Object.values(u).some((v) => v !== undefined), {
    message: "Give the tags, the skills, the format hints or preferred to change",
  });
export type CvUpdate = z.infer<typeof CvUpdateSchema>;

/**
 * The CV the app would use for a role and why ("German backend role → Backend (DE)", F2.3):
 * chosen automatically, or by an editor for that role. cvId null: no CV fits, or none uploaded.
 */
export const CvChoiceSchema = z.object({
  cvId: z.uuid().nullable(),
  reason: z.string(),
  source: z.enum(["auto", "you"]),
});
export type CvChoice = z.infer<typeof CvChoiceSchema>;

/** PUT /messages/:messageId/roles/:position/cv: an editor's choice; null goes back to automatic. */
export const CvChoiceOverrideSchema = z.object({ cvId: z.uuid().nullable() });
export type CvChoiceOverride = z.infer<typeof CvChoiceOverrideSchema>;

/** The largest role position: every position column (roles, role_evaluations…) is an int4. */
const MAX_ROLE_POSITION = 2_147_483_647;

/**
 * The path of PUT /messages/:messageId/roles/:position/cv: the Message-ID (decoded by the router)
 * and the role's position, a nonnegative integer like every other role position, at most what
 * the position columns hold (a larger one would fail in the database, not here).
 */
export const RoleParamsSchema = z.object({
  messageId: z.string().min(1),
  position: z.coerce.number().int().nonnegative().max(MAX_ROLE_POSITION),
});
