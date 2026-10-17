import {
  type Condition,
  type PayPeriod,
  RULE_ACTIONS,
  RULE_FACTS,
  RULE_OPS,
  type Rule,
  type RuleAction,
  type RuleOp,
} from "@jobfilly/schema";
import { type FormEvent, useState } from "react";
import { Alert, Button, SelectField, TextField } from "../../components";

// A rule made or changed by hand (MVP 3, F2.1): its conditions ("when every condition holds"),
// what it does, and optional words; without words the server describes it from its conditions.
// Each condition names a fact, how it is compared and with what: words, a range of UTC offsets,
// a pay threshold, or nothing ("isn't stated"). The server checks the values and says what is
// wrong in plain words.

const FACT_LABELS: Record<(typeof RULE_FACTS)[number], string> = {
  "places.country": "Country (ISO code)",
  workMode: "Work mode",
  timeZones: "Working hours (UTC offsets)",
  pay: "Pay",
  contract: "Contract",
  company: "Company",
  agency: "Agency",
  "sender.domain": "Sender's domain",
  category: "Category",
  skills: "Skills",
  languages: "Languages",
};

const OP_LABELS: Record<RuleOp, string> = {
  in: "is one of",
  not_in: "is none of",
  within: "is within",
  outside: "is outside",
  below: "is below",
  contains: "mentions",
  equals: "is",
  missing: "isn't stated",
};

const ACTION_LABELS: Record<RuleAction, string> = {
  hide: "Hide the role",
  no_draft: "Don't draft a reply",
  ask_first: "Ask me before replying",
  cap_score: "Cap its fit score",
};

const PERIODS: PayPeriod[] = ["hour", "day", "week", "month", "year"];

/**
 * One condition as the form holds it, every kind of value side by side. A new condition starts
 * with no fact and no comparison (""), so nothing is saved until the user picks both.
 */
interface Draft {
  fact: string;
  op: RuleOp | "";
  words: string;
  from: string;
  to: string;
  amount: string;
  currency: string;
  period: PayPeriod;
}

function toDraft(c: Condition): Draft {
  const v = c.value;
  const range = v && typeof v === "object" && "from" in v ? v : null;
  const pay = v && typeof v === "object" && "amount" in v ? v : null;
  return {
    fact: c.fact,
    op: c.op,
    words: Array.isArray(v) ? v.join(", ") : typeof v === "number" ? String(v) : "",
    from: range?.from ?? "",
    to: range?.to ?? "",
    amount: pay ? String(pay.amount) : "",
    currency: pay?.currency ?? "",
    period: pay?.period ?? "year",
  };
}

/** Only for a draft with a fact and a comparison (see `complete`). */
function toCondition(d: Draft): Condition {
  const fact = d.fact as Condition["fact"];
  if (d.op === "" || d.op === "missing") return { fact, op: "missing", value: null };
  if (d.op === "within" || d.op === "outside") {
    return { fact, op: d.op, value: { from: d.from.trim(), to: d.to.trim() } };
  }
  if (d.op === "below") {
    const value = {
      amount: Number(d.amount),
      currency: d.currency.trim().toUpperCase(),
      period: d.period,
    };
    return { fact, op: d.op, value };
  }
  const words = d.words
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w !== "");
  return { fact, op: d.op, value: words };
}

const EMPTY: Draft = {
  fact: "",
  op: "",
  words: "",
  from: "",
  to: "",
  amount: "",
  currency: "",
  period: "year",
};

const complete = (d: Draft) => d.fact !== "" && d.op !== "";

export interface RuleInput {
  description?: string;
  when: Condition[];
  then: RuleAction;
}

function ConditionFields(props: {
  n: number;
  draft: Draft;
  onChange: (draft: Draft) => void;
  onRemove: (() => void) | null;
}) {
  const { n, draft, onChange, onRemove } = props;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <fieldset className="flex flex-wrap items-end gap-2 rounded-md border border-stone-200 p-3">
      <legend className="px-1 text-xs text-stone-500">Condition {n}</legend>
      <SelectField label="Fact" value={draft.fact} onChange={(e) => set({ fact: e.target.value })}>
        <option value="" disabled>
          Choose a fact
        </option>
        {draft.fact !== "" && !(RULE_FACTS as readonly string[]).includes(draft.fact) && (
          <option value={draft.fact}>{draft.fact}</option>
        )}
        {RULE_FACTS.map((f) => (
          <option key={f} value={f}>
            {FACT_LABELS[f]}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Compared"
        value={draft.op}
        onChange={(e) => set({ op: e.target.value as RuleOp })}
      >
        <option value="" disabled>
          Choose how
        </option>
        {RULE_OPS.map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </SelectField>
      {(draft.op === "within" || draft.op === "outside") && (
        <>
          <TextField
            label="From"
            value={draft.from}
            onChange={(e) => set({ from: e.target.value })}
          />
          <TextField label="To" value={draft.to} onChange={(e) => set({ to: e.target.value })} />
        </>
      )}
      {draft.op === "below" && (
        <>
          <TextField
            label="Amount"
            inputMode="numeric"
            value={draft.amount}
            onChange={(e) => set({ amount: e.target.value })}
          />
          <TextField
            label="Currency (ISO code)"
            value={draft.currency}
            maxLength={3}
            onChange={(e) => set({ currency: e.target.value })}
          />
          <SelectField
            label="Per"
            value={draft.period}
            onChange={(e) => set({ period: e.target.value as PayPeriod })}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </SelectField>
        </>
      )}
      {["in", "not_in", "contains", "equals"].includes(draft.op) && (
        <TextField
          label="Words, separated by commas"
          value={draft.words}
          onChange={(e) => set({ words: e.target.value })}
        />
      )}
      {onRemove && (
        <Button variant="ghost" onClick={onRemove} aria-label={`Remove condition ${n}`}>
          Remove
        </Button>
      )}
    </fieldset>
  );
}

/** The form: a new rule (no `rule`), or the conditions, action and words of one. */
export function RuleEditor(props: {
  rule?: Rule;
  busy: boolean;
  error: string | null;
  onSave: (input: RuleInput) => void;
  onCancel: () => void;
}) {
  const { rule } = props;
  const [drafts, setDrafts] = useState<Draft[]>(rule ? rule.when.map(toDraft) : [EMPTY]);
  const ready = drafts.every(complete);
  const [then, setThen] = useState<RuleAction>(rule?.then ?? "hide");
  const [description, setDescription] = useState(rule?.description ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    // Old words kept with new conditions or a new action are worded afresh by the server.
    props.onSave({ when: drafts.map(toCondition), then, description: description.trim() });
  };
  return (
    <form
      onSubmit={submit}
      aria-label={rule ? "Change the rule" : "New rule"}
      className="flex flex-col gap-3"
    >
      <p className="text-sm text-stone-700">When every condition holds:</p>
      {drafts.map((draft, i) => (
        <ConditionFields
          // biome-ignore lint/suspicious/noArrayIndexKey: conditions have no id; the form keeps their order
          key={i}
          n={i + 1}
          draft={draft}
          onChange={(next) => setDrafts(drafts.map((d, k) => (k === i ? next : d)))}
          onRemove={drafts.length > 1 ? () => setDrafts(drafts.filter((_, k) => k !== i)) : null}
        />
      ))}
      <div>
        <Button variant="secondary" onClick={() => setDrafts([...drafts, EMPTY])}>
          Add a condition
        </Button>
      </div>
      <SelectField
        label="Then"
        value={then}
        onChange={(e) => setThen(e.target.value as RuleAction)}
        className="max-w-xs"
      >
        {RULE_ACTIONS.map((a) => (
          <option key={a} value={a}>
            {ACTION_LABELS[a]}
          </option>
        ))}
      </SelectField>
      <TextField
        label="In your words (optional)"
        hint="Left empty, the rule is described from its conditions."
        value={description}
        maxLength={300}
        onChange={(e) => setDescription(e.target.value)}
      />
      {props.error && <Alert>{props.error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" busy={props.busy} disabled={!ready}>
          Save rule
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
