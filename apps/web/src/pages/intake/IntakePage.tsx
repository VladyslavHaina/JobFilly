import {
  type Confidence,
  DEFAULT_PROFILE_NAME,
  type ExtraQuestion,
  type IntakeEdit,
  IntakeEditSchema,
  type IntakeForm,
  type IntakeProposalEntry,
  type ProfileKey,
  ProfileSchema,
  type ProfileValue,
} from "@jobfilly/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, api } from "../../api";
import { Alert, Button, Card, Loading, PageHeader } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { AnswerEditor } from "./answers";
import { Evidence } from "./Evidence";
import {
  intakeApi,
  intakeKey,
  profilesKey,
  useFormOpen,
  useIntakeForm,
  useProfiles,
} from "./queries";

// The intake form (F6): the scan's proposals with how sure the app is and why, the evidence behind
// each, corrections by clicking, up to five extra questions found in the mail, and Confirm, which
// saves the answers as the profile. Low-confidence and empty answers stand out. Viewers see it
// all, disabled.

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : "That didn't work. Try again.";

const BADGES: Record<Exclude<Confidence, null> | "none" | "you", { text: string; tone: string }> = {
  high: { text: "High confidence", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  medium: { text: "Medium confidence", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
  low: { text: "Low confidence", tone: "bg-amber-50 text-amber-900 ring-amber-300" },
  none: { text: "Not enough evidence", tone: "bg-amber-50 text-amber-900 ring-amber-300" },
  you: { text: "Set by you", tone: "bg-indigo-50 text-indigo-800 ring-indigo-200" },
};

function Badge({ kind }: { kind: keyof typeof BADGES }) {
  const { text, tone } = BADGES[kind];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
    >
      {text}
    </span>
  );
}

function AnswerCard(props: {
  label: string;
  badge: keyof typeof BADGES | null;
  why: string | null;
  attention: string | null;
  evidence: string[];
  children: ReactNode;
}) {
  const { workspaceId } = useWorkspace();
  const { label, badge, why, attention, evidence, children } = props;
  return (
    <section
      aria-label={label}
      data-attention={attention ? "true" : undefined}
      className={`rounded-lg border bg-white p-5 shadow-xs ${
        attention ? "border-amber-300 ring-1 ring-amber-200" : "border-stone-200"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-stone-900">{label}</h2>
        {badge && <Badge kind={badge} />}
        {why && <span className="text-sm text-stone-600">{why}</span>}
      </header>
      {attention && <p className="mt-1 text-sm font-medium text-amber-800">{attention}</p>}
      <div className="mt-3">{children}</div>
      <div className="mt-3">
        <Evidence workspaceId={workspaceId} messageIds={evidence} label={label} />
      </div>
    </section>
  );
}

/** What a core answer's card says, from its proposal and the user's edit. */
function describe(entry: IntakeProposalEntry, edit: IntakeEdit | undefined) {
  if (edit) {
    return { badge: "you" as const, why: null, attention: null };
  }
  if (entry.confidence === null || entry.value.length === 0) {
    return {
      badge: "none" as const,
      why: null,
      attention: "Nothing found in your mail. Add an answer if it matters to you.",
    };
  }
  const why = entry.evidence[0]?.reason ?? null;
  if (entry.confidence === "low") {
    return { badge: "low" as const, why, attention: "Not sure about this one: please check it." };
  }
  return { badge: entry.confidence, why, attention: null };
}

function Extras(props: {
  form: IntakeForm;
  edits: Map<string, IntakeEdit>;
  disabled: boolean;
  onChange: (key: ProfileKey, value: ProfileValue) => void;
}) {
  const { form, edits, disabled, onChange } = props;
  const { status, questions } = form.extras;
  if (status === "pending") {
    return <Loading label="Looking for more questions in your mail…" />;
  }
  if (questions.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-stone-900">More questions from your mail</h2>
      {questions.map((q: ExtraQuestion) => {
        const key: ProfileKey = `extra.${q.slug}`;
        return (
          <AnswerCard
            key={q.slug}
            label={q.label}
            badge={edits.has(key) ? "you" : null}
            why={null}
            attention={null}
            evidence={q.evidence}
          >
            <AnswerEditor
              entryKey={key}
              question={q}
              label={q.label}
              value={edits.get(key)?.value ?? []}
              disabled={disabled}
              onChange={(value) => onChange(key, value)}
            />
          </AnswerCard>
        );
      })}
    </div>
  );
}

function Form({ form, confirmed }: { form: IntakeForm; confirmed: boolean }) {
  const { workspaceId, can } = useWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const edits = new Map(form.edits.map((e) => [e.key, e]));
  const disabled = !can.edit || confirmed;

  const save = useMutation({
    mutationFn: (input: { key: ProfileKey; value: ProfileValue }) =>
      api(`${intakeApi(workspaceId)}/answers/${encodeURIComponent(input.key)}`, IntakeEditSchema, {
        method: "PUT",
        body: { value: input.value },
      }),
    onSuccess: (edit) => {
      client.setQueryData<IntakeForm>(intakeKey(workspaceId), (current) =>
        current
          ? { ...current, edits: [...current.edits.filter((e) => e.key !== edit.key), edit] }
          : current,
      );
    },
  });
  const confirm = useMutation({
    mutationFn: () =>
      api(`${intakeApi(workspaceId)}/confirm`, ProfileSchema, { method: "POST", body: {} }),
    onSuccess: async (profile) => {
      client.setQueryData(profilesKey(workspaceId), [profile]);
      await navigate(paths.profile(workspaceId));
    },
  });
  const change = (key: ProfileKey, value: ProfileValue) => save.mutate({ key, value });

  return (
    <div className="flex flex-col gap-4">
      {save.error && <Alert>{errorText(save.error)}</Alert>}
      {form.proposal.entries.map((entry) => {
        const edit = edits.get(entry.key);
        return (
          <AnswerCard
            key={entry.key}
            label={entry.label}
            {...describe(entry, edit)}
            evidence={entry.evidence.map((e) => e.messageId)}
          >
            <AnswerEditor
              entryKey={entry.key}
              label={entry.label}
              value={edit?.value ?? entry.value}
              disabled={disabled}
              onChange={(value) => change(entry.key, value)}
            />
          </AnswerCard>
        );
      })}
      <Extras form={form} edits={edits} disabled={disabled} onChange={change} />
      {!confirmed && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-stone-600">
            {can.edit
              ? `Confirm saves these answers as your profile, “${DEFAULT_PROFILE_NAME}”. You can rename it later.`
              : "Only editors and admins can change and confirm the answers."}
          </p>
          <Button disabled={!can.edit} busy={confirm.isPending} onClick={() => confirm.mutate()}>
            Confirm
          </Button>
          {confirm.error && <Alert>{errorText(confirm.error)}</Alert>}
        </Card>
      )}
    </div>
  );
}

export function IntakePage({ workspaceId }: { workspaceId: string }) {
  const { can } = useWorkspace();
  const gate = useFormOpen(workspaceId);
  const form = useIntakeForm(workspaceId, gate.open);
  const profiles = useProfiles(workspaceId);
  const confirmed = profiles.data?.[0];

  const header = (
    <PageHeader
      title="Your job search"
      description="What the scan understood from your mail. Check each answer, correct it with a click, then confirm."
    />
  );

  const notReady =
    !gate.open || (form.error instanceof ApiError && form.error.code === "not_ready");
  if (gate.pending) {
    return (
      <section>
        {header}
        <Loading />
      </section>
    );
  }
  if (notReady) {
    return (
      <section>
        {header}
        <Alert tone="info" title="Not ready yet">
          The form fills itself in once the first scan has stopped.{" "}
          <Link className="font-medium underline" to={paths.scan(workspaceId)}>
            Go to the scan
          </Link>
        </Alert>
      </section>
    );
  }
  return (
    <section>
      {header}
      <div className="mb-4 flex flex-col gap-3">
        {confirmed && (
          <Alert tone="success" title="Confirmed">
            Saved as “{confirmed.name}”.{" "}
            <Link className="font-medium underline" to={paths.profile(workspaceId)}>
              Open your profile
            </Link>
          </Alert>
        )}
        {!can.edit && !confirmed && (
          <Alert tone="info">
            You can see the answers; only editors and admins can change them.
          </Alert>
        )}
      </div>
      {form.isPending && <Loading />}
      {form.isError && <Alert>{errorText(form.error)}</Alert>}
      {form.data && <Form form={form.data} confirmed={!!confirmed} />}
    </section>
  );
}
