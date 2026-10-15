import {
  CV_UPLOAD_FILE_FIELD,
  type Cv,
  CvSchema,
  type CvTag,
  type CvUpdate,
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
// the AI, which suggests its language, role families and seniority as tags, and lists the skills
// (as the CV writes them; any the text doesn't contain were dropped) and its format hints. All
// three are editable tags: users remove any and add their own ("preferred"); a skill is added
// only if the CV's text contains it (F2.2), which the server checks. Download for everyone;
// delete for editors.

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

/** PATCH /cvs/:cvId, the answer replacing the CV in the list. */
function useCvEdit(cv: Cv) {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (change: CvUpdate) =>
      api(`${cvsPath(workspaceId)}/${cv.id}`, CvSchema, { method: "PATCH", body: change }),
    onSuccess: (updated) =>
      client.setQueryData<Cv[]>(cvsKey(workspaceId), (list) =>
        list?.map((c) => (c.id === updated.id ? updated : c)),
      ),
  });
}

function CvCard({ cv }: { cv: Cv }) {
  const { workspaceId, can } = useWorkspace();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: cvsKey(workspaceId) });
  const tags = useCvEdit(cv);
  const skills = useCvEdit(cv);
  const hints = useCvEdit(cv);
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
  // While a change is saved, the fields show it, so a refetch in between doesn't undo it.
  const labels =
    (tags.isPending && tags.variables.tags?.map((t) => t.label)) || cv.tags.map((t) => t.label);
  const skillLabels = (skills.isPending && skills.variables.skills) || cv.skills;
  const hintLabels = (hints.isPending && hints.variables.formatHints) || cv.formatHints;
  const read = cv.readStatus === "done";
  const error = tags.error ?? skills.error ?? hints.error ?? remove.error ?? download.error;
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
        onChange={(next) => tags.mutate({ tags: nextTags(cv.tags, next) })}
      />
      {read && (
        <>
          <div className="flex flex-col gap-1">
            <TagInput
              label={`Skills in ${cv.name}`}
              tags={skillLabels}
              disabled={!can.edit || skills.isPending}
              placeholder={can.edit ? "Add a skill the CV lists" : undefined}
              onChange={(next) => skills.mutate({ skills: next })}
            />
            <p className="text-xs text-stone-500">
              Only skills written in the CV are listed; one you add must be in it too.
            </p>
          </div>
          <TagInput
            label={`Format of ${cv.name}`}
            tags={hintLabels}
            disabled={!can.edit || hints.isPending}
            placeholder={can.edit ? "Add a format hint, e.g. one page" : undefined}
            onChange={(next) => hints.mutate({ formatHints: next })}
          />
        </>
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
