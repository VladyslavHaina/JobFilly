import {
  AI_TASKS,
  type AiModels,
  type AiProvider,
  type AiProviderId,
  AiProviderListSchema,
  type AiSettingsPublic,
  AiSettingsResponseSchema,
  type AiTask,
  type AiTestResult,
  AiTestResultSchema,
  baseUrlHost,
  DEFAULT_BUDGET_PER_RUN,
} from "@jobfilly/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "../../api";
import { Alert, Button, Card, Loading, SelectField, TextField } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";

// "Pick your AI" (onboarding) and Settings › AI (F3). A short list of providers, a key and/or a
// base URL, a model per task pre-selected from the provider's defaults, the run budget, a Test
// button and the one privacy line. The key is typed, sent to save or test, and never shown again.
// The providers, their default hosts and models come from the server (GET /ai/providers), so
// nothing vendor-specific lives in the web app.

type Mode = "onboarding" | "settings";

const TASK_LABELS: Record<AiTask, string> = {
  classify: "Model for sorting mail",
  extract: "Model for job facts",
  prefs: "Model for your preferences",
  intake: "Model for extra questions",
  cv: "Model for reading CVs",
  match: "Model for matching roles",
  draft: "Model for reply drafts",
  assistant: "Model for the assistant",
};

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : error ? "That didn't work. Try again." : null;

const aiKey = (workspaceId: string) => [...queryKeys.area(workspaceId, "workspace"), "ai"] as const;

interface FormState {
  provider: AiProviderId | "";
  baseUrl: string;
  apiKey: string;
  models: AiModels;
  budget: string;
}

function initialState(saved: AiSettingsPublic | null): FormState {
  return saved
    ? {
        provider: saved.provider,
        baseUrl: saved.baseUrl ?? "",
        apiKey: "",
        models: saved.models,
        budget: String(saved.budgetPerRun),
      }
    : {
        provider: "",
        baseUrl: "",
        apiKey: "",
        models: {
          classify: "",
          extract: "",
          prefs: "",
          intake: "",
          cv: "",
          match: "",
          draft: "",
          assistant: "",
        },
        budget: String(DEFAULT_BUDGET_PER_RUN),
      };
}

function TestOutcome({ result }: { result: AiTestResult }) {
  return result.ok ? (
    <Alert tone="success">Test succeeded: the AI answered.</Alert>
  ) : (
    <Alert title="The test didn't work">{result.message}</Alert>
  );
}

/** The privacy line's data while the user types: the base URL's host, else the provider's own. */
const readByOf = (info: AiProvider, baseUrl: string | null) => ({
  provider: info.label,
  host: baseUrl ? baseUrlHost(baseUrl) : (info.defaultHost ?? ""),
});

function Form(props: {
  providers: AiProvider[];
  saved: AiSettingsPublic | null;
  mode: Mode;
  onSaved?: () => void;
}) {
  const { workspaceId, can } = useWorkspace();
  // The AI reads mail text: only admins who see everything change it; the server refuses anyone
  // else.
  const canChange = can.admin && can.mail;
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initialState(props.saved));
  const [tested, setTested] = useState<AiTestResult | null>(null);
  const [saved, setSaved] = useState(false);
  const providerInfo = (id: AiProviderId | "") => props.providers.find((p) => p.id === id) ?? null;
  const info = providerInfo(form.provider);
  const baseUrl = form.baseUrl.trim() || null;
  const sameEndpoint =
    props.saved !== null &&
    props.saved.provider === form.provider &&
    (props.saved.baseUrl ?? null) === baseUrl;
  const keyStored = sameEndpoint && (props.saved?.hasKey ?? false);
  const readBy = info ? readByOf(info, baseUrl) : null;

  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTested(null);
    setSaved(false);
  };
  const choose = (provider: AiProviderId | "") => {
    const chosen = providerInfo(provider);
    if (!chosen) return update({ provider: "" });
    const keepSaved = props.saved?.provider === provider;
    update({
      provider,
      models: keepSaved && props.saved ? props.saved.models : chosen.defaultModels,
      baseUrl: keepSaved ? (props.saved?.baseUrl ?? "") : "",
      apiKey: "",
    });
  };
  const body = () => ({
    provider: form.provider,
    baseUrl,
    models: form.models,
    ...(form.apiKey ? { apiKey: form.apiKey } : {}),
    budgetPerRun: Number(form.budget),
  });

  const base = `${apiPaths.workspace(workspaceId)}/ai`;
  const test = useMutation({
    mutationFn: () => api(`${base}/test`, AiTestResultSchema, { method: "POST", body: body() }),
    onMutate: () => setTested(null),
    onSuccess: setTested,
    // The test is a model call too, counted in the usage below the form; no live event follows it.
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "usage") }),
  });
  const save = useMutation({
    mutationFn: () => api(base, AiSettingsResponseSchema, { method: "PUT", body: body() }),
    onSuccess: (response) => {
      // The key is never kept or shown once it is stored.
      setForm((f) => ({ ...f, apiKey: "" }));
      setSaved(true);
      client.setQueryData(aiKey(workspaceId), response);
      props.onSaved?.();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const error = errorText(test.error ?? save.error);
  const busy = test.isPending || save.isPending;

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Pick your AI">
        <fieldset disabled={!canChange} className="flex flex-col gap-4">
          <SelectField
            label="AI provider"
            value={form.provider}
            onChange={(e) => choose(e.target.value as AiProviderId | "")}
          >
            <option value="">Choose a provider</option>
            {props.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </SelectField>

          {info && (
            <>
              <TextField
                label={info.baseUrlRequired ? "Base URL" : "Base URL (optional)"}
                type="url"
                required={info.baseUrlRequired}
                placeholder={info.baseUrlRequired ? "http://localhost:11434/v1" : undefined}
                hint={
                  info.baseUrlRequired
                    ? "The address of the endpoint's OpenAI-compatible API, ending in /v1."
                    : `Leave empty to use ${info.label} directly.`
                }
                value={form.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value })}
              />
              <TextField
                label={info.keyRequired ? "API key" : "API key (optional)"}
                type="password"
                autoComplete="off"
                required={info.keyRequired && !keyStored}
                hint={keyStored ? "A key is stored. Leave this empty to keep it." : undefined}
                value={form.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
              <fieldset className="grid gap-4 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-medium text-stone-800">Models per task</legend>
                {AI_TASKS.map((task) => (
                  <TextField
                    key={task}
                    label={TASK_LABELS[task]}
                    required
                    value={form.models[task]}
                    onChange={(e) => update({ models: { ...form.models, [task]: e.target.value } })}
                  />
                ))}
              </fieldset>
              <TextField
                label="Model calls per scan run"
                type="number"
                inputMode="numeric"
                min={1}
                required
                hint="A scan run stops when it has made this many calls."
                value={form.budget}
                onChange={(e) => update({ budget: e.target.value })}
              />
              {readBy?.host && (
                <p className="text-sm text-stone-700">
                  Your mail is read by {readBy.provider} ({readBy.host})
                </p>
              )}
            </>
          )}
        </fieldset>

        {test.isPending && (
          <p role="status" className="text-sm text-stone-600">
            Waiting for the AI to answer…
          </p>
        )}
        {tested && <TestOutcome result={tested} />}
        {error && <Alert>{error}</Alert>}
        {saved && props.mode === "settings" && <Alert tone="success">Saved.</Alert>}

        {can.admin && !can.mail && (
          <p className="text-xs text-stone-500">Only admins who see everything change the AI.</p>
        )}
        {info && canChange && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              busy={test.isPending}
              disabled={busy}
              onClick={() => test.mutate()}
            >
              Test
            </Button>
            <Button type="submit" busy={save.isPending} disabled={busy}>
              {props.mode === "onboarding" ? "Save and continue" : "Save"}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

export function AiForm(props: { workspaceId: string; mode: Mode; onSaved?: () => void }) {
  const base = `${apiPaths.workspace(props.workspaceId)}/ai`;
  const settings = useQuery({
    queryKey: aiKey(props.workspaceId),
    queryFn: () => api(base, AiSettingsResponseSchema),
  });
  const providers = useQuery({
    queryKey: [...aiKey(props.workspaceId), "providers"],
    queryFn: () => api(`${base}/providers`, AiProviderListSchema),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (settings.isLoading || providers.isLoading) return <Loading />;
  const failed = settings.error ?? providers.error;
  if (failed) return <Alert>{errorText(failed)}</Alert>;
  return (
    <Form
      providers={providers.data?.items ?? []}
      saved={settings.data?.settings ?? null}
      mode={props.mode}
      onSaved={props.onSaved}
    />
  );
}
