import {
  CV_UPLOAD_FILE_FIELD,
  type Cv,
  CvSchema,
  type CvTag,
  MAX_CV_BYTES,
} from "@jobfilly/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useId, useState } from "react";
import { api, apiDownload, apiUpload, apiVoid } from "../../api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  Loading,
  PageHeader,
  TagInput,
} from "../../components";
import { useWorkspace } from "../../hooks";
import { formatFullDate } from "../inbox/format";
import { cvsKey, cvsPath, errorText, useCvs } from "./queries";

// The CVs page (F2.1, F2.5): editors upload PDF or DOCX files (several at once), each is read by
// the AI, which suggests its language, role families, seniority and format as tags; the skills it
// found are listed as the CV writes them (any the text doesn't contain were dropped). Tags are
// editable and users add their own ("preferred"). Download for everyone; delete for editors.

const ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function ReadStatus({ cv }: { cv: Cv }) {
  if (cv.readStatus === "pending") return <Badge tone="info">Reading…</Badge>;
  if (cv.readStatus === "failed") return <Badge tone="danger">Couldn't read</Badge>;
  return null;
}

/** Saves the tags as the user leaves them: a label that was there keeps its source. */
function nextTags(current: readonly CvTag[], labels: string[]): CvTag[] {
  return labels.map(
    (label) => current.find((t) => t.label === label) ?? { label, source: "you" as const },
  );
}

function CvCard({ cv }: { cv: Cv }) {
  const { workspaceId, can } = useWorkspace();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: cvsKey(workspaceId) });
  const tags = useMutation({
    mutationFn: (labels: string[]) =>
      api(`${cvsPath(workspaceId)}/${cv.id}`, CvSchema, {
        method: "PATCH",
        body: { tags: nextTags(cv.tags, labels) },
      }),
    onSuccess: (updated) =>
      client.setQueryData<Cv[]>(cvsKey(workspaceId), (list) =>
        list?.map((c) => (c.id === updated.id ? updated : c)),
      ),
  });
  const remove = useMutation({
    mutationFn: () => apiVoid(`${cvsPath(workspaceId)}/${cv.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirming(false);
      await refresh();
    },
  });
  const download = useMutation({
    mutationFn: async () => {
      const { blob, fileName } = await apiDownload(`${cvsPath(workspaceId)}/${cv.id}/file`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName ?? cv.fileName;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const labels = (tags.isPending && tags.variables) || cv.tags.map((t) => t.label);
  const error = tags.error ?? remove.error ?? download.error;
  return (
    <Card className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold break-words text-stone-900">{cv.name}</h2>
          <p className="text-xs text-stone-500">
            {cv.fileName} · {formatSize(cv.sizeBytes)} · uploaded {formatFullDate(cv.uploadedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReadStatus cv={cv} />
          <Button variant="secondary" busy={download.isPending} onClick={() => download.mutate()}>
            Download
          </Button>
          {can.edit && (
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>
      </header>
      {cv.readStatus === "failed" && (
        <Alert tone="warning">
          The AI couldn't read this CV, so it has no suggested tags or skills. Upload it again to
          retry.
        </Alert>
      )}
      <TagInput
        label={`Tags for ${cv.name}`}
        tags={labels}
        disabled={!can.edit || tags.isPending}
        placeholder={can.edit ? "Add a tag, e.g. preferred" : undefined}
        onChange={(next) => tags.mutate(next)}
      />
      {cv.skills.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-stone-800">Skills found in the CV</p>
          <ul aria-label={`Skills in ${cv.name}`} className="flex flex-wrap gap-1.5">
            {cv.skills.map((skill) => (
              <li
                key={skill}
                className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700"
              >
                {skill}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <Alert>{errorText(error)}</Alert>}
      <Dialog
        title={`Delete ${cv.name}?`}
        open={confirming}
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
              Delete
            </Button>
          </>
        }
      >
        The file is removed from JobFilly and roles choose another CV. Drafts already in your
        mailbox stay there.
      </Dialog>
    </Card>
  );
}

function Upload() {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  const id = useId();
  const [errors, setErrors] = useState<string[]>([]);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const failed: string[] = [];
      for (const file of files) {
        if (file.size > MAX_CV_BYTES) {
          failed.push(`${file.name}: a CV can be at most 5 MB`);
          continue;
        }
        const form = new FormData();
        form.set(CV_UPLOAD_FILE_FIELD, file);
        try {
          await apiUpload(cvsPath(workspaceId), form, CvSchema);
        } catch (error) {
          failed.push(`${file.name}: ${errorText(error)}`);
        }
        await client.invalidateQueries({ queryKey: cvsKey(workspaceId) });
      }
      setErrors(failed);
    },
  });
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length > 0) upload.mutate(files);
  };
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600"
      >
        {upload.isPending ? "Uploading…" : "Upload CVs"}
        <input
          id={id}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={upload.isPending}
          onChange={onChange}
          className="sr-only"
        />
      </label>
      <p className="text-xs text-stone-500">PDF or DOCX, at most 5 MB each.</p>
      {errors.length > 0 && (
        <Alert title="Some files weren't uploaded">
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}

export function CvsPage({ workspaceId }: { workspaceId: string }) {
  const { can } = useWorkspace();
  const cvs = useCvs(workspaceId);
  return (
    <section>
      <PageHeader
        title="CVs"
        description="Upload the CVs you send. Each is read for its language, role families and skills, and every role gets the CV that fits it, with the reason."
      />
      <div className="flex flex-col gap-4">
        {can.edit ? (
          <Upload />
        ) : (
          <Alert tone="info">
            You can see and download the CVs; only editors and admins can change them.
          </Alert>
        )}
        {cvs.isPending && <Loading />}
        {cvs.isError && <Alert>{errorText(cvs.error)}</Alert>}
        {cvs.data?.length === 0 && <p className="text-sm text-stone-600">No CVs uploaded yet.</p>}
        {cvs.data?.map((cv) => (
          <CvCard key={cv.id} cv={cv} />
        ))}
      </div>
    </section>
  );
}
