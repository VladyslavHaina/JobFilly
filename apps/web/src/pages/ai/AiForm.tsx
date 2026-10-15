import {
  AI_PROVIDERS,
  AI_TASKS,
  type AiModels,
  type AiProviderId,
  type AiSettingsPublic,
  AiSettingsResponseSchema,
  type AiTask,
  type AiTestResult,
  AiTestResultSchema,
  aiProvider,
  aiReadBy,
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

type Mode = "onboarding" | "settings";

const TASK_LABELS: Record<AiTask, string> = {
  classify: "Model for sorting mail",
  extract: "Model for job facts",
  prefs: "Model for your preferences",
  intake: "Model for extra questions",
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
        models: { classify: "", extract: "", prefs: "", intake: "" },
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

function Form(props: { saved: AiSettingsPublic | null; mode: Mode; onSaved?: () => void }) {
  const { workspaceId, can } = useWorkspace();
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initialState(props.saved));
  const [tested, setTested] = useState<AiTestResult | null>(null);
  const [saved, setSaved] = useState(false);
  const info = form.provider ? aiProvider(form.provider) : null;
  const baseUrl = form.baseUrl.trim() || null;
  const sameEndpoint =
    props.saved !== null &&
    props.saved.provider === form.provider &&
    (props.saved.baseUrl ?? null) === baseUrl;
  const keyStored = sameEndpoint && (props.saved?.hasKey ?? false);
  const readBy = form.provider ? aiReadBy(form.provider, baseUrl) : null;

  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTested(null);
    setSaved(false);
  };
  const choose = (provider: AiProviderId | "") => {
    if (!provider) return update({ provider });
    const keepSaved = props.saved?.provider === provider;
    update({
      provider,
      models: keepSaved && props.saved ? props.saved.models : aiProvider(provider).defaultModels,
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
        <fieldset disabled={!can.admin} className="flex flex-col gap-4">
          <SelectField
            label="AI provider"
            value={form.provider}
            onChange={(e) => choose(e.target.value as AiProviderId | "")}
          >
            <option value="">Choose a provider</option>
            {AI_PROVIDERS.map((p) => (
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

        {info && can.admin && (
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
  const settings = useQuery({
    queryKey: aiKey(props.workspaceId),
    queryFn: () => api(`${apiPaths.workspace(props.workspaceId)}/ai`, AiSettingsResponseSchema),
  });
  if (settings.isLoading) return <Loading />;
  if (settings.error) return <Alert>{errorText(settings.error)}</Alert>;
  return <Form saved={settings.data?.settings ?? null} mode={props.mode} onSaved={props.onSaved} />;
}
