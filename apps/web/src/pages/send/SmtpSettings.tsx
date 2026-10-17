import type {
  MailboxPublic,
  MailPreset,
  SmtpSettingsInput,
  SmtpSettingsView,
  SmtpTestResult,
  TlsMode,
} from "@jobfilly/schema";
import { useState } from "react";
import { errorText } from "../../api";
import { Alert, Button, Card, Loading, SelectField, TextField } from "../../components";
import { useWorkspace } from "../../hooks";
import { useMailboxes, useMailPresets, useSaveSmtp, useSmtpSettings, useTestSmtp } from "./queries";

// Settings › Sending (F4): each mailbox's SMTP server, which its drafts are sent through. The
// provider preset fills the server, port and security; Test signs in without sending anything.
// The password is typed, sent once, and never shown again; it is kept only for the same server.
// A Google mailbox has nothing to set. Admins change it; everyone else reads it.

const TLS_LABELS: Record<TlsMode, string> = {
  tls: "TLS",
  starttls: "STARTTLS",
  none: "None (plain text)",
};

/** The form's first values: what is saved, else the preset whose IMAP server the mailbox uses. */
function initial(mailbox: MailboxPublic, view: SmtpSettingsView, presets: readonly MailPreset[]) {
  if (view.smtp) return { ...view.smtp, password: "" };
  const preset = presets.find((p) => p.host === mailbox.host)?.smtp;
  return {
    host: preset?.host ?? "",
    port: preset?.port ?? 465,
    tlsMode: preset?.tlsMode ?? ("tls" as TlsMode),
    username: mailbox.username,
    password: "",
  };
}

function MailboxSmtpForm({
  workspaceId,
  mailbox,
  view,
  presets,
}: {
  workspaceId: string;
  mailbox: MailboxPublic;
  view: SmtpSettingsView;
  presets: readonly MailPreset[];
}) {
  const { can } = useWorkspace();
  // Where mail goes is for admins who see everything; the server refuses anyone else (TBD-450).
  const canChange = can.admin && can.mail;
  const [form, setForm] = useState(() => initial(mailbox, view, presets));
  const [tested, setTested] = useState<SmtpTestResult | null>(null);
  const save = useSaveSmtp(workspaceId, mailbox.id);
  const test = useTestSmtp(workspaceId, mailbox.id);
  const input = (): SmtpSettingsInput => ({
    host: form.host.trim(),
    port: form.port,
    tlsMode: form.tlsMode,
    username: form.username,
    ...(form.password ? { password: form.password } : {}),
  });
  const update = (change: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...change }));
    setTested(null);
  };
  const withSmtp = presets.filter((p) => p.smtp);
  const keepsPassword =
    view.smtp !== null && view.smtp.host.toLowerCase() === form.host.trim().toLowerCase();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(input(), { onSuccess: () => update({ password: "" }) });
      }}
    >
      <SelectField
        label="Provider"
        value={withSmtp.find((p) => p.smtp?.host === form.host)?.id ?? "other"}
        disabled={!canChange}
        onChange={(e) => {
          const smtp = presets.find((p) => p.id === e.target.value)?.smtp;
          if (smtp) update({ host: smtp.host, port: smtp.port, tlsMode: smtp.tlsMode });
        }}
      >
        {withSmtp.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="other">Other SMTP server</option>
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_10rem]">
        <TextField
          label="SMTP server"
          value={form.host}
          disabled={!canChange}
          onChange={(e) => update({ host: e.target.value })}
        />
        <TextField
          label="Port"
          type="number"
          value={form.port}
          disabled={!canChange}
          onChange={(e) => update({ port: Number(e.target.value) })}
        />
        <SelectField
          label="Security"
          value={form.tlsMode}
          disabled={!canChange}
          onChange={(e) => update({ tlsMode: e.target.value as TlsMode })}
        >
          {(Object.keys(TLS_LABELS) as TlsMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {TLS_LABELS[mode]}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField
        label="User name"
        value={form.username}
        disabled={!canChange}
        onChange={(e) => update({ username: e.target.value })}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        value={form.password}
        disabled={!canChange}
        onChange={(e) => update({ password: e.target.value })}
        hint={
          keepsPassword
            ? "Leave it empty to keep the saved password."
            : "Some providers need an app password."
        }
      />
      {tested?.ok && <Alert tone="success">The SMTP server accepted the sign-in.</Alert>}
      {tested && !tested.ok && <Alert>{tested.message}</Alert>}
      {test.error && <Alert>{errorText(test.error)}</Alert>}
      {save.error && <Alert>{errorText(save.error)}</Alert>}
      {save.isSuccess && !save.isPending && <Alert tone="success">Saved.</Alert>}
      {canChange ? (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            busy={test.isPending}
            disabled={!form.host.trim() || !form.username}
            onClick={() => test.mutate(input(), { onSuccess: setTested })}
          >
            Test
          </Button>
          <Button type="submit" busy={save.isPending} disabled={!form.host.trim()}>
            Save
          </Button>
        </div>
      ) : (
        <p className="text-xs text-stone-500">
          {can.admin
            ? "Only admins who see everything change how mail is sent."
            : "Only admins change how mail is sent."}
        </p>
      )}
    </form>
  );
}

function MailboxSmtp(props: {
  workspaceId: string;
  mailbox: MailboxPublic;
  presets: readonly MailPreset[];
}) {
  const view = useSmtpSettings(props.workspaceId, props.mailbox.id);
  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-stone-900">{props.mailbox.address}</h3>
      {props.mailbox.auth === "google" ? (
        <p className="text-sm text-stone-600">
          Sends through Google with your sign-in. There is nothing to set.
        </p>
      ) : view.isLoading ? (
        <Loading />
      ) : view.error || !view.data ? (
        <Alert>{errorText(view.error)}</Alert>
      ) : (
        <>
          <p className="mb-3 text-sm text-stone-600">
            {view.data.smtp
              ? "Drafts of this mailbox can be sent."
              : "Add its SMTP server to send drafts from it."}
          </p>
          <MailboxSmtpForm {...props} view={view.data} />
        </>
      )}
    </Card>
  );
}

export function SmtpSettings({ workspaceId }: { workspaceId: string }) {
  const mailboxes = useMailboxes(workspaceId);
  const presets = useMailPresets(workspaceId);
  if (mailboxes.isLoading || presets.isLoading) return <Loading />;
  const failed = mailboxes.error ?? presets.error;
  if (failed) return <Alert>{errorText(failed)}</Alert>;
  const items = mailboxes.data?.items ?? [];
  if (items.length === 0) {
    return <Alert tone="info">Connect a mailbox first; then add its SMTP server here.</Alert>;
  }
  return (
    <div className="flex flex-col gap-4">
      {items.map((mailbox) => (
        <MailboxSmtp
          key={mailbox.id}
          workspaceId={workspaceId}
          mailbox={mailbox}
          presets={presets.data?.items ?? []}
        />
      ))}
    </div>
  );
}
