import {
  MailboxListSchema,
  type MailboxPublic,
  MailboxPublicSchema,
  type MailPreset,
  type MailPresetId,
  MailPresetListSchema,
  type MailTestResult,
  MailTestResultSchema,
  type TlsMode,
} from "@jobfilly/schema";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError, api, apiVoid } from "../../api";
import { Alert, Button, Card, Loading, SelectField, TextField } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";

// "Connect your mailbox" (onboarding) and Settings › Mailbox (F2). One mailbox per workspace: when
// one is connected the form shows it, with Disconnect, and offers no way to add another. The
// password is typed, sent once to test or save, and never shown again (F2.3).

type Mode = "onboarding" | "settings";

const TLS_LABELS: Record<TlsMode, string> = {
  tls: "TLS",
  starttls: "STARTTLS",
  none: "None (plain text)",
};

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : error ? "That didn't work. Try again." : null;

const mailboxKey = (workspaceId: string) =>
  [...queryKeys.area(workspaceId, "workspace"), "mailboxes"] as const;

/**
 * After a connect or disconnect: this form's mailbox and the mailbox status (F1.4) in the inbox
 * header and Settings › Mailbox, which reads the same list under the "mailbox" area.
 */
function refreshMailboxes(client: QueryClient, workspaceId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: mailboxKey(workspaceId) }),
    client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "mailbox") }),
  ]);
}

/** "Sent" for the usual name; otherwise the folder's own name too. */
function sentLabel(path: string): string {
  const name = path.split(/[/.]/).at(-1) ?? path;
  return name.toLowerCase() === "sent" ? "Sent" : `Sent (${path})`;
}

function TestOutcome({ result }: { result: MailTestResult }) {
  if (!result.ok) return <Alert title="Couldn't connect">{result.message}</Alert>;
  return (
    <Alert tone="success">
      {result.sentPath ? (
        <>Connected: Inbox, {sentLabel(result.sentPath)}</>
      ) : (
        <>
          Connected: Inbox. No Sent folder was found, so your own replies won't be read for your
          preferences.
        </>
      )}
    </Alert>
  );
}

function ConnectedMailbox(props: {
  mailbox: MailboxPublic;
  mode: Mode;
  canManage: boolean;
  onContinue?: () => void;
}) {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { mailbox } = props;
  const disconnect = useMutation({
    mutationFn: () =>
      apiVoid(`${apiPaths.workspace(workspaceId)}/mailboxes/${mailbox.id}`, { method: "DELETE" }),
    onSuccess: () => refreshMailboxes(client, workspaceId),
  });
  const error = errorText(disconnect.error);
  return (
    <Card>
      <h2 className="text-base font-semibold text-stone-900">Connected mailbox</h2>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-500">Address</dt>
        <dd className="text-stone-900">{mailbox.address}</dd>
        <dt className="text-stone-500">Server</dt>
        <dd className="text-stone-900">
          {mailbox.host}:{mailbox.port} · {TLS_LABELS[mailbox.tlsMode]}
        </dd>
        <dt className="text-stone-500">Folders read</dt>
        <dd className="text-stone-900">
          Inbox{mailbox.sentFolderPath ? `, ${sentLabel(mailbox.sentFolderPath)}` : ""}
        </dd>
      </dl>
      <p className="mt-3 text-xs text-stone-500">
        A workspace has one mailbox. To use another one, disconnect this one first.
      </p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {props.mode === "onboarding" && props.onContinue && (
          <Button onClick={props.onContinue}>Continue</Button>
        )}
        {props.canManage &&
          (confirming ? (
            <>
              <Button
                variant="danger"
                busy={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect and delete the stored password
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          ))}
      </div>
    </Card>
  );
}

interface FormState {
  presetId: MailPresetId | "";
  address: string;
  username: string;
  password: string;
  host: string;
  port: string;
  tlsMode: TlsMode;
}

const EMPTY: FormState = {
  presetId: "",
  address: "",
  username: "",
  password: "",
  host: "",
  port: "993",
  tlsMode: "tls",
};

function ConnectForm(props: { presets: MailPreset[]; mode: Mode; onConnected?: () => void }) {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [tested, setTested] = useState<MailTestResult | null>(null);
  const preset = props.presets.find((p) => p.id === form.presetId) ?? null;
  const other = preset?.id === "other";

  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTested(null);
  };
  const choose = (id: MailPresetId | "") => {
    const p = props.presets.find((x) => x.id === id);
    update({
      presetId: id,
      ...(p && p.id !== "other"
        ? { host: p.host, port: String(p.port), tlsMode: p.tlsMode }
        : { host: "", port: "993", tlsMode: "tls" }),
    });
  };
  const body = () => ({
    address: form.address,
    username: other && form.username.trim() ? form.username.trim() : form.address.trim(),
    password: form.password,
    host: form.host,
    port: Number(form.port),
    tlsMode: form.tlsMode,
  });

  const base = `${apiPaths.workspace(workspaceId)}/mailboxes`;
  const test = useMutation({
    mutationFn: () => api(`${base}/test`, MailTestResultSchema, { method: "POST", body: body() }),
    onMutate: () => setTested(null),
    onSuccess: setTested,
  });
  const save = useMutation({
    mutationFn: () => api(base, MailboxPublicSchema, { method: "POST", body: body() }),
    onSuccess: (mailbox) => {
      // The password is never kept or shown once it is stored.
      setForm((f) => ({ ...f, password: "" }));
      client.setQueryData(mailboxKey(workspaceId), { items: [mailbox] });
      void refreshMailboxes(client, workspaceId);
      props.onConnected?.();
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
      <form onSubmit={submit} className="flex flex-col gap-4" aria-label="Connect your mailbox">
        <SelectField
          label="Mail provider"
          value={form.presetId}
          onChange={(e) => choose(e.target.value as MailPresetId | "")}
        >
          <option value="">Choose your mail provider</option>
          {props.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </SelectField>

        {preset?.needsAppPassword && (
          <Alert tone="info" title={`${preset.label} needs an app password`}>
            Use an app password made for JobFilly, not your normal password.{" "}
            {preset.helpUrl && (
              <a
                href={preset.helpUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium underline"
              >
                How to create an app password at {preset.label}
              </a>
            )}
          </Alert>
        )}
        {preset && !preset.needsAppPassword && preset.helpUrl && (
          <p className="text-xs text-stone-600">
            {preset.label} may need IMAP access turned on first.{" "}
            <a
              href={preset.helpUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline"
            >
              {preset.label}'s IMAP help
            </a>
          </p>
        )}

        {preset && (
          <>
            <TextField
              label="Email address"
              type="email"
              autoComplete="email"
              required
              value={form.address}
              onChange={(e) => update({ address: e.target.value })}
            />
            {other && (
              <>
                <TextField
                  label="User name"
                  hint="Leave empty to use the email address."
                  autoComplete="username"
                  value={form.username}
                  onChange={(e) => update({ username: e.target.value })}
                />
                <div className="grid gap-4 sm:grid-cols-[1fr_8rem_12rem]">
                  <TextField
                    label="IMAP server"
                    required
                    value={form.host}
                    onChange={(e) => update({ host: e.target.value })}
                  />
                  <TextField
                    label="Port"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65535}
                    required
                    value={form.port}
                    onChange={(e) => update({ port: e.target.value })}
                  />
                  <SelectField
                    label="Security"
                    value={form.tlsMode}
                    onChange={(e) => update({ tlsMode: e.target.value as TlsMode })}
                  >
                    {(Object.keys(TLS_LABELS) as TlsMode[]).map((mode) => (
                      <option key={mode} value={mode}>
                        {TLS_LABELS[mode]}
                      </option>
                    ))}
                  </SelectField>
                </div>
              </>
            )}
            {!other && (
              <p className="text-xs text-stone-500">
                Server: {form.host}:{form.port} · {TLS_LABELS[form.tlsMode]}
              </p>
            )}
            <TextField
              label={preset.needsAppPassword ? "App password" : "Password"}
              type="password"
              autoComplete="off"
              required
              value={form.password}
              onChange={(e) => update({ password: e.target.value })}
            />

            {tested && <TestOutcome result={tested} />}
            {error && <Alert>{error}</Alert>}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                busy={test.isPending}
                disabled={busy}
                onClick={() => test.mutate()}
              >
                {test.isPending ? "Testing…" : "Test connection"}
              </Button>
              <Button type="submit" busy={save.isPending} disabled={busy}>
                {props.mode === "onboarding" ? "Save and continue" : "Save"}
              </Button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}

export function MailboxForm(props: { workspaceId: string; mode: Mode; onConnected?: () => void }) {
  const { can } = useWorkspace();
  const base = `${apiPaths.workspace(props.workspaceId)}/mailboxes`;
  const mailboxes = useQuery({
    queryKey: mailboxKey(props.workspaceId),
    queryFn: () => api(base, MailboxListSchema),
  });
  const presets = useQuery({
    queryKey: [...mailboxKey(props.workspaceId), "presets"],
    queryFn: () => api(`${base}/presets`, MailPresetListSchema),
    enabled: can.admin,
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (mailboxes.isLoading || (can.admin && presets.isLoading)) return <Loading />;
  const failed = mailboxes.error ?? presets.error;
  if (failed) return <Alert>{errorText(failed)}</Alert>;
  const mailbox = mailboxes.data?.items[0];
  if (mailbox) {
    return (
      <ConnectedMailbox
        mailbox={mailbox}
        mode={props.mode}
        canManage={can.admin}
        onContinue={props.onConnected}
      />
    );
  }
  if (!can.admin) {
    return (
      <p className="text-sm text-stone-600">
        No mailbox is connected yet. An admin of this workspace can connect one.
      </p>
    );
  }
  return (
    <ConnectForm
      presets={presets.data?.items ?? []}
      mode={props.mode}
      onConnected={props.onConnected}
    />
  );
}
