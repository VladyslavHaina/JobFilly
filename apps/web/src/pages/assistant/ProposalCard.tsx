import { type Change, type ChangeLine, type Proposal, ProposalSchema } from "@jobfilly/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api } from "../../api";
import { Alert, Badge, Button, Switch, TextField } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { buildChanges, entryField, type RawFields, rawFields, valueField } from "./edit";
import { errorText, impactWords, proposalApi } from "./queries";

// A proposal card (F8.2): the change in plain words, before and after for each entry and rule,
// and its impact on the current roles. Nothing changes until Apply, which only editors and admins
// can press (F8.8); before that an editor can edit the card (the time-zone range, say) and the
// impact is worked out again. Discard leaves everything as it was.

function LineView({ line }: { line: ChangeLine }) {
  return (
    <li className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{line.label}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-stone-500">Before</dt>
        <dd className="text-stone-800">
          {line.before ?? (line.target === "rule" ? "No such rule" : "Not set")}
        </dd>
        <dt className="text-stone-500">After</dt>
        <dd className="text-stone-900">{line.after ?? "Removed"}</dd>
      </dl>
    </li>
  );
}

const FACT_WORDS: Record<string, string> = {
  timeZones: "Hours",
  "places.country": "Countries",
  workMode: "Work modes",
  pay: "Pay",
  contract: "Contracts",
  company: "Companies",
  agency: "Agencies",
  "sender.domain": "Sender domains",
  category: "Categories",
  skills: "Skills",
  languages: "Languages",
};

function ChangeFields({
  change,
  index,
  raw,
  set,
}: {
  change: Change;
  index: number;
  raw: RawFields;
  set: (key: string, value: string) => void;
}) {
  const field = (key: string, label: string, hint?: string) => (
    <TextField
      key={key}
      label={label}
      hint={hint}
      value={raw[key] ?? ""}
      onChange={(e) => set(key, e.target.value)}
    />
  );
  if (change.target === "rule") {
    if (change.op === "remove") return <p className="text-sm text-stone-600">Removes the rule.</p>;
    return (
      <div className="flex flex-col gap-2">
        {field(
          `${index}.description`,
          "Rule in plain words",
          "Leave it to have it reworded after an edit.",
        )}
        {change.rule.when.map((c, j) => {
          const key = `${index}.when.${j}`;
          const what = FACT_WORDS[c.fact] ?? c.fact.replace(/^extra\./, "");
          switch (valueField(c.value)) {
            case "range":
              return (
                <div key={key} className="grid grid-cols-2 gap-2">
                  {field(`${key}.from`, `${what} from`, "A UTC offset, like UTC+4")}
                  {field(`${key}.to`, `${what} to`, "A UTC offset, like UTC+14")}
                </div>
              );
            case "words":
              return field(key, what, "Separate them with commas");
            case "number":
              return field(key, what);
            case "amount":
              return field(key, `${what} amount`);
            default:
              return null;
          }
        })}
      </div>
    );
  }
  if (change.value === null) return <p className="text-sm text-stone-600">Clears the entry.</p>;
  const kind = entryField(change.value);
  if (kind === "words") return field(`${index}.value`, change.key, "Separate them with commas");
  if (kind === "number") return field(`${index}.value`, change.key);
  return <p className="text-sm text-stone-600">This entry can't be edited here.</p>;
}

function EditForm({
  proposal,
  workspaceId,
  onDone,
}: {
  proposal: Proposal;
  workspaceId: string;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [raw, setRaw] = useState<RawFields>(() => rawFields(proposal.changes));
  const [enabled, setEnabled] = useState<Record<number, boolean>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (changes: Change[]) =>
      api(proposalApi(workspaceId, proposal.id), ProposalSchema, {
        method: "PATCH",
        body: { changes },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "assistant") });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const built = buildChanges(proposal.changes, raw);
    if (!built.ok) {
      setProblem(built.error);
      return;
    }
    setProblem(null);
    save.mutate(
      built.changes.map((c, i) =>
        c.target === "rule" && c.op !== "remove" && i in enabled
          ? { ...c, rule: { ...c.rule, enabled: enabled[i] ?? c.rule.enabled } }
          : c,
      ),
    );
  };
  return (
    <form aria-label="Edit the proposal" onSubmit={submit} className="flex flex-col gap-3">
      {proposal.changes.map((change, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a proposal's changes have no ids; their order is fixed
        <fieldset key={i} className="flex flex-col gap-2 rounded-md border border-stone-200 p-3">
          <ChangeFields
            change={change}
            index={i}
            raw={raw}
            set={(key, value) => setRaw((r) => ({ ...r, [key]: value }))}
          />
          {change.target === "rule" && change.op !== "remove" && (
            <Switch
              label="On"
              checked={enabled[i] ?? change.rule.enabled}
              onChange={(on) => setEnabled((s) => ({ ...s, [i]: on }))}
            />
          )}
        </fieldset>
      ))}
      {problem && <Alert>{problem}</Alert>}
      {save.isError && <Alert>{errorText(save.error)}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" busy={save.isPending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

const STATUS_WORDS: Record<Proposal["status"], string> = {
  open: "Open",
  applied: "Applied",
  discarded: "Discarded",
};

export function ProposalCard({
  workspaceId,
  proposal,
}: {
  workspaceId: string;
  proposal: Proposal;
}) {
  const { can } = useWorkspace();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const refresh = () =>
    Promise.all(
      (["assistant", "profiles", "messages"] as const).map((area) =>
        client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, area) }),
      ),
    );
  const decide = useMutation({
    mutationFn: (action: "apply" | "discard") =>
      api(proposalApi(workspaceId, proposal.id, action), ProposalSchema, { method: "POST" }),
    onSuccess: refresh,
  });
  const open = proposal.status === "open";
  return (
    <article
      aria-label={`Proposal: ${proposal.summary}`}
      className="flex flex-col gap-3 rounded-lg border border-indigo-200 bg-white p-4 shadow-xs"
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-stone-900">{proposal.summary}</h3>
        {!open && (
          <Badge tone={proposal.status === "applied" ? "success" : "neutral"}>
            {STATUS_WORDS[proposal.status]}
          </Badge>
        )}
      </header>
      {editing ? (
        <EditForm proposal={proposal} workspaceId={workspaceId} onDone={() => setEditing(false)} />
      ) : (
        <ul aria-label="Before and after" className="flex flex-col gap-2">
          {proposal.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lines follow the changes' fixed order
            <LineView key={i} line={line} />
          ))}
        </ul>
      )}
      <p className="text-sm text-stone-700">
        <span className="font-medium">Impact on your current roles:</span>{" "}
        {impactWords(proposal.impact)}
      </p>
      {open && !editing && (
        <>
          {!can.edit && (
            <p className="text-xs text-stone-500">Only editors and admins can apply changes.</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={decide.isPending}
              onClick={() => decide.mutate("discard")}
            >
              Discard
            </Button>
            <Button variant="secondary" disabled={!can.edit} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              disabled={!can.edit}
              busy={decide.isPending && decide.variables === "apply"}
              onClick={() => decide.mutate("apply")}
            >
              Apply
            </Button>
          </div>
        </>
      )}
      {decide.isError && <Alert>{errorText(decide.error)}</Alert>}
    </article>
  );
}
