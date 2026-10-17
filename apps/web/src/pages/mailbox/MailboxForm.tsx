import {
  MailboxListSchema,
  type MailboxPublic,
  MailboxPublicSchema,
  MailboxRemovalSummarySchema,
  type MailPreset,
  type MailPresetId,
  MailPresetListSchema,
  type MailTestResult,
  MailTestResultSchema,
  type OAuthOutcome,
  OAuthOutcomeSchema,
  OAuthProvidersSchema,
  OAuthStartSchema,
  type TlsMode,
} from "@jobfilly/schema";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError, api, apiVoid } from "../../api";
import { Alert, Button, Card, Loading, SelectField, TextField } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";

// "Connect your mailbox" (onboarding) and Settings › Mailbox (F2, MVP 3 F3). A workspace connects
// several mailboxes (F3.1): each shows as a card, with Disconnect, and admins add another with the
// IMAP form or, when the server has Google's client settings, Sign in with Google (F3.2). The
// password is typed, sent once to test or save, and never shown again (F2.3); a Google mailbox's
// tokens never reach the browser. A Google mailbox Google stopped accepting says "Reconnect
// needed", with Reconnect with Google. Disconnecting says first what goes with the mailbox
// (F7.4). Google's sign-in comes back here with its outcome in the `oauth` query parameter.

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
 * After a connect or disconnect: this form's mailboxes and the mailbox status (F1.4) in the inbox
 * header and Settings › Mailbox, which reads the same list under the "mailbox" area, and the
 * inbox, whose mail a disconnect removes.
 */
function refreshMailboxes(client: QueryClient, workspaceId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: mailboxKey(workspaceId) }),
    client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "mailbox") }),
    client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "messages") }),
  ]);
}

/** "Sent" for the usual name; otherwise the folder's own name too. */
function sentLabel(path: string): string {
  const name = path.split(/[/.]/).at(-1) ?? path;
  return name.toLowerCase() === "sent" ? "Sent" : `Sent (${path})`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Starts Sign in with Google (a reconnect names its mailbox) and goes to Google's page. */
function useGoogleSignIn(workspaceId: string) {
  return useMutation({
    mutationFn: (mailboxId?: string) =>
      api(`${apiPaths.workspace(workspaceId)}/oauth/google/start`, OAuthStartSchema, {
        method: "POST",
        body: mailboxId ? { mailboxId } : {},
      }),
    onSuccess: ({ url }) => {
      window.open(url, "_self");
    },
  });
}

const OUTCOMES: Record<OAuthOutcome, { tone: "success" | "info" | "error"; text: string }> = {
  connected: { tone: "success", text: "Your Gmail mailbox is connected." },
  denied: { tone: "info", text: "Google sign-in was cancelled, so nothing was connected." },
  failed: { tone: "error", text: "Google sign-in didn't work. Try again." },
  exists: { tone: "info", text: "That Gmail mailbox is already connected to this workspace." },
  wrong_account: {
    tone: "error",
    text: "That was another Google account. Reconnect with the mailbox's own account.",
  },
};

/** What Google's sign-in came back with, once, from the `oauth` query parameter. */
function OAuthOutcomeNote() {
  const [search] = useSearchParams();
  const outcome = OAuthOutcomeSchema.safeParse(search.get("oauth"));
  if (!outcome.success) return null;
  const { tone, text } = OUTCOMES[outcome.data];
  return <Alert tone={tone}>{text}</Alert>;
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

/** Disconnect's confirmation: what goes with the mailbox, and what stays in it (F7.4). */
function DisconnectConfirmation(props: { mailbox: MailboxPublic; onKeep: () => void }) {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  const path = `${apiPaths.workspace(workspaceId)}/mailboxes/${props.mailbox.id}`;
  const summary = useQuery({
    queryKey: [...mailboxKey(workspaceId), props.mailbox.id, "removal"],
    queryFn: () => api(`${path}/removal`, MailboxRemovalSummarySchema),
    staleTime: 0,
  });
  const disconnect = useMutation({
    mutationFn: () => apiVoid(path, { method: "DELETE" }),
    onSuccess: () => refreshMailboxes(client, workspaceId),
  });
  const s = summary.data;
  return (
    <div className="mt-4 flex flex-col gap-3">
      {summary.isLoading && <Loading />}
      {summary.error && <Alert>{errorText(summary.error)}</Alert>}
      {s && (
        <Alert tone="warning" title={`Disconnect ${s.address}?`}>
          <p>
            This deletes its stored sign-in and the {plural(s.messages, "message")} synced from it,
            with their {plural(s.roles, "role")}, {plural(s.drafts, "draft")} and{" "}
            {plural(s.decisions, "open decision")}.
          </p>
          <p className="mt-1">Mail and drafts in the mailbox itself stay there.</p>
        </Alert>
      )}
      {disconnect.error && <Alert>{errorText(disconnect.error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          busy={disconnect.isPending}
          disabled={!s}
          onClick={() => disconnect.mutate()}
        >
          Disconnect and delete its data
        </Button>
        <Button variant="ghost" onClick={props.onKeep}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function ConnectedMailbox(props: {
  mailbox: MailboxPublic;
  /** May disconnect it. */
  canManage: boolean;
  /** May sign it in again. */
  canConnect: boolean;
}) {
  const { workspaceId } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const reconnect = useGoogleSignIn(workspaceId);
  const { mailbox } = props;
  const google = mailbox.auth === "google";
  return (
    <Card>
      {/* Headed by its address: with several mailboxes, each card says which one it is. */}
      <h2 className="text-base font-semibold text-stone-900">{mailbox.address}</h2>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-stone-500">Signs in with</dt>
        <dd className="text-stone-900">{google ? "Google" : "Password"}</dd>
        <dt className="text-stone-500">Server</dt>
        <dd className="text-stone-900">
          {mailbox.host}:{mailbox.port} · {TLS_LABELS[mailbox.tlsMode]}
        </dd>
        <dt className="text-stone-500">Folders read</dt>
        <dd className="text-stone-900">
          Inbox{mailbox.sentFolderPath ? `, ${sentLabel(mailbox.sentFolderPath)}` : ""}
        </dd>
      </dl>
      {mailbox.status === "reconnect_needed" && (
        <div className="mt-3 flex flex-col gap-2">
          <Alert tone="warning" title="Reconnect needed">
            Google no longer accepts this mailbox's sign-in. Nothing stored is lost: sign in again
            and it carries on where it stopped.
          </Alert>
          {props.canConnect && (
            <div>
              <Button busy={reconnect.isPending} onClick={() => reconnect.mutate(mailbox.id)}>
                Reconnect with Google
              </Button>
            </div>
          )}
          {reconnect.error && <Alert>{errorText(reconnect.error)}</Alert>}
        </div>
      )}
      {props.canManage &&
        (confirming ? (
          <DisconnectConfirmation mailbox={mailbox} onKeep={() => setConfirming(false)} />
        ) : (
          <div className="mt-4">
            <Button
              variant="secondary"
              aria-label={`Disconnect ${mailbox.address}`}
              onClick={() => setConfirming(true)}
            >
              Disconnect
            </Button>
          </div>
        ))}
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

function ConnectForm(props: {
  presets: MailPreset[];
  mode: Mode;
  google: boolean;
  onConnected?: () => void;
}) {
  const { workspaceId } = useWorkspace();
  const client = useQueryClient();
  const signIn = useGoogleSignIn(workspaceId);
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
      setForm(EMPTY);
      setTested(null);
      client.setQueryData(
        mailboxKey(workspaceId),
        (list: { items: MailboxPublic[] } | undefined) => ({
          items: [...(list?.items ?? []), mailbox],
        }),
      );
      void refreshMailboxes(client, workspaceId);
      props.onConnected?.();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const error = errorText(test.error ?? save.error ?? signIn.error);
  const busy = test.isPending || save.isPending;

  return (
    <Card>
      {props.google && (
        <div className="mb-4 flex flex-col gap-2 border-b border-stone-200 pb-4">
          <div>
            <Button busy={signIn.isPending} onClick={() => signIn.mutate(undefined)}>
              Sign in with Google
            </Button>
          </div>
          <p className="text-xs text-stone-500">
            For Gmail: Google asks you to allow JobFilly, and no password is stored. Or connect any
            mailbox over IMAP below.
          </p>
        </div>
      )}
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
        {error && <Alert>{error}</Alert>}
      </form>
    </Card>
  );
}

export function MailboxForm(props: { workspaceId: string; mode: Mode; onConnected?: () => void }) {
  const { can } = useWorkspace();
  // Connecting a mailbox (or signing it in again) is for admins who see everything; the server
  // refuses anyone else (TBD-450). Any admin may still disconnect one.
  const canConnect = can.admin && can.mail;
  const [adding, setAdding] = useState(false);
  const base = `${apiPaths.workspace(props.workspaceId)}/mailboxes`;
  const mailboxes = useQuery({
    queryKey: mailboxKey(props.workspaceId),
    queryFn: () => api(base, MailboxListSchema),
  });
  const presets = useQuery({
    queryKey: [...mailboxKey(props.workspaceId), "presets"],
    queryFn: () => api(`${base}/presets`, MailPresetListSchema),
    enabled: canConnect,
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Whether this server offers Sign in with Google (F3.2).
  const providers = useQuery({
    queryKey: ["oauth", "providers"],
    queryFn: () => api("/api/oauth/providers", OAuthProvidersSchema),
    enabled: canConnect,
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (mailboxes.isLoading || (canConnect && presets.isLoading)) return <Loading />;
  const failed = mailboxes.error ?? presets.error;
  if (failed) return <Alert>{errorText(failed)}</Alert>;
  const items = mailboxes.data?.items ?? [];
  const showForm = canConnect && (items.length === 0 || adding);
  return (
    <div className="flex flex-col gap-4">
      <OAuthOutcomeNote />
      {items.map((m) => (
        <ConnectedMailbox key={m.id} mailbox={m} canManage={can.admin} canConnect={canConnect} />
      ))}
      {items.length === 0 && !can.admin && (
        <p className="text-sm text-stone-600">
          No mailbox is connected yet. An admin of this workspace can connect one.
        </p>
      )}
      {can.admin && !canConnect && (
        <p className="text-sm text-stone-600">
          Only admins who see everything connect a mailbox or sign one in again.
        </p>
      )}
      {showForm && (
        <ConnectForm
          presets={presets.data?.items ?? []}
          mode={props.mode}
          google={providers.data?.google ?? false}
          onConnected={() => {
            setAdding(false);
            props.onConnected?.();
          }}
        />
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {props.mode === "onboarding" && props.onConnected && (
            <Button onClick={props.onConnected}>Continue</Button>
          )}
          {canConnect && !adding && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Connect another mailbox
            </Button>
          )}
          {adding && (
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
