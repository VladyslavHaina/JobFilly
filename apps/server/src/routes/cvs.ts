import { createHash } from "node:crypto";
import { checkSkills } from "@jobfilly/core";
import {
  deleteCv,
  getCv,
  getCvFile,
  insertCv,
  linkCvToProfiles,
  listCvs,
  updateCv,
} from "@jobfilly/db";
import {
  CV_MIME_TYPES,
  CV_READ_JOB,
  CV_UPLOAD_FILE_FIELD,
  type Cv,
  type CvList,
  CvUpdateSchema,
  CvUploadFieldsSchema,
  jobDedupeKey,
  MAX_CV_BYTES,
} from "@jobfilly/schema";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { NOT_FOUND, requireRole, validJson, validParam, type WorkspaceEnv } from "../access";
import { extractCvText, sniffCvType } from "../cvs/text";
import type { AppDeps } from "../deps";
import { enqueue } from "../jobs/queue";
import { requestReevaluation } from "../profile/changes";

// CVs (F2): list, upload (multipart, at most 5 MB, PDF or DOCX), edit (tags, skills, format
// hints), delete, download.
// Mounted once at /api/workspaces/:workspaceId/cvs; viewers read, editors change.
//
// An upload is read in memory and stored in Postgres (F2.4): the file's type comes from its
// bytes, its text is read at once (a file without readable text is refused), and cv.read is
// enqueued to read it with the AI. Editing a CV or deleting it can change the CV a role uses and
// the skills it is matched with, so the roles are re-evaluated; a draft already in the mailbox
// stays there (F2.5). A skill can be removed, and added only when the CV's text contains it, so
// a CV never lists a skill it doesn't have (F2.2).

const CvParamSchema = z.object({ cvId: z.uuid() });

/** Room for the multipart framing and the name field around a 5 MB file. */
const MULTIPART_OVERHEAD = 64 * 1024;

const TOO_LARGE = { error: "too_large", message: "A CV can be at most 5 MB" } as const;
const NO_FILE = { error: "invalid", message: "Choose a PDF or DOCX file to upload" } as const;
const UNSUPPORTED = {
  error: "unsupported_type",
  message: "Only PDF and DOCX files can be uploaded",
} as const;
const NOT_READ = {
  error: "not_read",
  message: "This CV hasn't been read yet, so it has no skills or format hints to change",
} as const;
const UNREADABLE = {
  error: "unreadable",
  message: "Couldn't read any text in this file. Is it a scan? Upload a PDF or DOCX with text.",
} as const;

/** The file's own name, without a path, kept short. */
function cleanFileName(name: string, mediaType: Cv["mediaType"]): string {
  const base =
    name
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\p{Cc}"]/gu, "")
      .trim() ?? "";
  return base ? base.slice(0, 200) : `cv.${mediaType}`;
}

/** The CV's name: as given, or its file name without the extension. */
function cvName(given: string | undefined, fileName: string): string {
  if (given) return given;
  const stem = fileName.replace(/\.[^.]+$/, "").trim();
  return (stem || "CV").slice(0, 100);
}

/** Content-Disposition for a download, with the UTF-8 name and a plain ASCII fallback. */
function attachment(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function cvsRoutes(deps: AppDeps) {
  return new Hono<WorkspaceEnv>()
    .get("/", requireRole("viewer"), async (c) => {
      const items = await listCvs(deps.db, c.get("workspaceId"));
      return c.json({ items } satisfies CvList);
    })
    .post(
      "/",
      requireRole("editor"),
      bodyLimit({
        maxSize: MAX_CV_BYTES + MULTIPART_OVERHEAD,
        onError: (c) => c.json(TOO_LARGE, 413),
      }),
      async (c) => {
        const workspaceId = c.get("workspaceId");
        let body: Record<string, string | File | (string | File)[]>;
        try {
          body = await c.req.parseBody();
        } catch {
          return c.json(NO_FILE, 400);
        }
        const file = body[CV_UPLOAD_FILE_FIELD];
        if (!(file instanceof File)) return c.json(NO_FILE, 400);
        if (file.size > MAX_CV_BYTES) return c.json(TOO_LARGE, 413);
        const fields = CvUploadFieldsSchema.safeParse({
          name: typeof body.name === "string" && body.name.trim() ? body.name : undefined,
        });
        if (!fields.success) {
          const message = fields.error.issues[0]?.message ?? "The name is not valid";
          return c.json({ error: "invalid", message }, 400);
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mediaType = sniffCvType(bytes);
        if (!mediaType) return c.json(UNSUPPORTED, 415);
        const text = await extractCvText(mediaType, bytes);
        if (!text) return c.json(UNREADABLE, 422);

        const fileName = cleanFileName(file.name, mediaType);
        const cv = await insertCv(deps.db, workspaceId, {
          name: cvName(fields.data.name, fileName),
          fileName,
          mediaType,
          bytes,
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          text,
          createdBy: c.get("user").id,
          at: deps.clock.now(),
        });
        await linkCvToProfiles(deps.db, workspaceId, cv.id);
        await enqueue(deps, workspaceId, {
          type: CV_READ_JOB,
          payload: { workspaceId, cvId: cv.id },
          dedupeKey: jobDedupeKey.cvRead(cv.id),
        });
        deps.log.info("cv.uploaded", {
          workspaceId,
          userId: c.get("user").id,
          cvId: cv.id,
          mediaType,
          sizeBytes: cv.sizeBytes,
        });
        await deps.live.publish(workspaceId, { type: "cvs.updated", data: {} });
        return c.json(cv satisfies Cv, 201);
      },
    )
    .patch(
      "/:cvId",
      requireRole("editor"),
      validParam(CvParamSchema),
      validJson(CvUpdateSchema),
      async (c) => {
        const workspaceId = c.get("workspaceId");
        const { cvId } = c.req.valid("param");
        const change = c.req.valid("json");
        if (change.skills || change.formatHints) {
          const current = await getCv(deps.db, workspaceId, cvId);
          if (!current) return c.json(NOT_FOUND, 404);
          if (current.readStatus !== "done") return c.json(NOT_READ, 409);
          if (change.skills) {
            // Each skill once, and only one the CV's text contains (F2.2).
            const { kept, dropped } = checkSkills(change.skills, current.text ?? "");
            const [missing] = dropped;
            if (missing !== undefined) {
              const message = `"${missing}" isn't in the CV's text, so it can't be one of its skills`;
              return c.json({ error: "skill_not_in_cv", message }, 422);
            }
            change.skills = kept;
          }
        }
        const cv = await updateCv(deps.db, workspaceId, cvId, change, deps.clock.now());
        if (!cv) return c.json(NOT_FOUND, 404);
        await deps.live.publish(workspaceId, { type: "cvs.updated", data: {} });
        // A tag such as "preferred", a role family or a skill can change which CV a role uses.
        await requestReevaluation(deps, workspaceId, { all: true }, "cv.edited");
        return c.json(cv satisfies Cv);
      },
    )
    .delete("/:cvId", requireRole("editor"), validParam(CvParamSchema), async (c) => {
      const workspaceId = c.get("workspaceId");
      if (!(await deleteCv(deps.db, workspaceId, c.req.valid("param").cvId))) {
        return c.json(NOT_FOUND, 404);
      }
      await deps.live.publish(workspaceId, { type: "cvs.updated", data: {} });
      await requestReevaluation(deps, workspaceId, { all: true }, "cv.deleted");
      return c.body(null, 204);
    })
    .get("/:cvId/file", requireRole("viewer"), validParam(CvParamSchema), async (c) => {
      const file = await getCvFile(deps.db, c.get("workspaceId"), c.req.valid("param").cvId);
      if (!file) return c.json(NOT_FOUND, 404);
      return c.body(new Uint8Array(file.bytes), 200, {
        "Content-Type": CV_MIME_TYPES[file.mediaType],
        "Content-Disposition": attachment(file.fileName),
        "Content-Length": String(file.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
    });
}
