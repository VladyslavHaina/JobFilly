import {
  type Category,
  CountryCodeSchema,
  CurrencyCodeSchema,
  type ExtraQuestion,
  isExtraKey,
  JOB_CATEGORIES,
  type PayPeriod,
  PayPeriodSchema,
  type ProfileKey,
  type ProfileValue,
  type ProfileValues,
} from "@jobfilly/schema";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button, SelectField, TextField } from "../../components";
import {
  CATEGORY_LABELS,
  countryName,
  formatPay,
  formatPeriod,
  formatTimeZones,
  parseAmount,
} from "../inbox/format";

// One answer of the intake form or the profile, shown and edited by clicking where possible
// (F6.4): every value is a chip that a click removes, reply_to and the extra questions' options
// are toggles, and typing is only needed to add something the scan didn't find. Values are shown
// as written; only ISO countries and currencies are interpreted (named and formatted).

type Places = ProfileValues["places"];
type Remote = ProfileValues["remote"];
type MinPay = ProfileValues["min_pay"];
type Permits = ProfileValues["work_permits"];

function formatProfilePlace(p: Places[number]): string {
  return `${[p.city, countryName(p.country)].filter(Boolean).join(", ")} (${p.mode})`;
}

function formatRemote(r: Remote[number]): string {
  const zones = r.timeZones ? formatTimeZones(r.timeZones) : null;
  return [r.scope || "Remote", zones].filter(Boolean).join(", ");
}

function formatMinPay(m: MinPay[number]): string {
  const normalised = formatPay({
    min: m.amount,
    max: m.amount,
    currency: m.currency,
    period: m.period,
    asWritten: m.asWritten,
  });
  return normalised && m.asWritten && normalised !== m.asWritten
    ? `${normalised} (“${m.asWritten}”)`
    : (normalised ?? m.asWritten);
}

function formatPermit(w: Permits[number]): string {
  return w.country ? `${w.text} (${countryName(w.country)})` : w.text;
}

function Chips({
  items,
  disabled,
  onRemove,
}: {
  items: string[];
  disabled: boolean;
  onRemove: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((text, i) => (
        <li
          // Two chips can read the same (a value worded twice); the position tells them apart.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={`${i}-${text}`}
          className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-1 pr-1 pl-3 text-sm text-stone-800"
        >
          {text}
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove ${text}`}
            onClick={() => onRemove(i)}
            className="rounded-full px-1.5 text-stone-500 hover:bg-stone-200 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

function Toggle({
  label,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm ring-1 ring-inset disabled:cursor-not-allowed disabled:opacity-60 ${
        pressed
          ? "bg-indigo-600 text-white ring-indigo-600"
          : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50"
      }`}
    >
      {label}
    </button>
  );
}

/** A small inline form that adds one item; `onSubmit` checks the fields and adds it. */
function AddForm({
  label,
  disabled,
  children,
  onSubmit,
}: {
  label: string;
  disabled: boolean;
  children: ReactNode;
  onSubmit: () => void;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form aria-label={label} onSubmit={submit} className="flex flex-wrap items-end gap-2">
      {children}
      <Button type="submit" variant="secondary" disabled={disabled}>
        Add
      </Button>
    </form>
  );
}

type Change = (value: ProfileValue) => void;

interface EditorProps {
  label: string;
  value: ProfileValue;
  disabled: boolean;
  onChange: Change;
}

function WordsEditor({ label, value, disabled, onChange }: EditorProps) {
  const words = value as string[];
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <Chips
        items={words}
        disabled={disabled}
        onRemove={(i) => onChange(words.filter((_, j) => j !== i))}
      />
      <AddForm
        label={`Add to ${label}`}
        disabled={disabled}
        onSubmit={() => {
          const word = text.trim();
          if (!word) return;
          if (!words.some((w) => w.trim().toLowerCase() === word.toLowerCase())) {
            onChange([...words, word]);
          }
          setText("");
        }}
      >
        <TextField
          label={`Add to ${label.toLowerCase()}`}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
      </AddForm>
    </div>
  );
}

function ReplyToEditor({ value, disabled, onChange }: EditorProps) {
  const chosen = value as Category[];
  return (
    <div className="flex flex-wrap gap-2">
      {JOB_CATEGORIES.map((c) => (
        <Toggle
          key={c}
          label={CATEGORY_LABELS[c]}
          pressed={chosen.includes(c)}
          disabled={disabled}
          onClick={() =>
            onChange(chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c])
          }
        />
      ))}
    </div>
  );
}

const upper = (s: string) => s.trim().toUpperCase();

function PlacesEditor({ value, disabled, onChange }: EditorProps) {
  const places = value as Places;
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  // No work mode is chosen for the user: they pick one for each place they add.
  const [mode, setMode] = useState<Places[number]["mode"] | "">("");
  const [error, setError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Chips
        items={places.map(formatProfilePlace)}
        disabled={disabled}
        onRemove={(i) => onChange(places.filter((_, j) => j !== i))}
      />
      <AddForm
        label="Add a place"
        disabled={disabled}
        onSubmit={() => {
          const countryOk = CountryCodeSchema.safeParse(upper(country)).success;
          setError(countryOk ? null : "Use the two-letter country code, like DE or GB");
          setModeError(mode ? null : "Choose onsite or hybrid");
          if (!countryOk || !mode) return;
          onChange([...places, { country: upper(country), city: city.trim() || null, mode }]);
          setCity("");
          setCountry("");
          setMode("");
        }}
      >
        <TextField
          label="City"
          value={city}
          disabled={disabled}
          onChange={(e) => setCity(e.target.value)}
        />
        <TextField
          label="Country code"
          value={country}
          maxLength={2}
          disabled={disabled}
          error={error}
          onChange={(e) => setCountry(e.target.value)}
        />
        <SelectField
          label="Work mode"
          value={mode}
          disabled={disabled}
          error={modeError}
          onChange={(e) => setMode(e.target.value as Places[number]["mode"] | "")}
        >
          <option value="">Choose…</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">Onsite</option>
        </SelectField>
      </AddForm>
    </div>
  );
}

function RemoteEditor({ value, disabled, onChange }: EditorProps) {
  const remote = value as Remote;
  const [scope, setScope] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <Chips
        items={remote.map(formatRemote)}
        disabled={disabled}
        onRemove={(i) => onChange(remote.filter((_, j) => j !== i))}
      />
      <AddForm
        label="Add a remote scope"
        disabled={disabled}
        onSubmit={() => {
          if (!scope.trim()) return;
          onChange([...remote, { scope: scope.trim(), timeZones: null }]);
          setScope("");
        }}
      >
        <TextField
          label="Remote scope, as you'd say it"
          value={scope}
          disabled={disabled}
          onChange={(e) => setScope(e.target.value)}
        />
      </AddForm>
    </div>
  );
}

function MinPayEditor({ value, disabled, onChange }: EditorProps) {
  const pays = value as MinPay;
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  // No pay period is chosen for the user: hours, days and years are all common.
  const [period, setPeriod] = useState<PayPeriod | "">("");
  const [error, setError] = useState<string | null>(null);
  const [periodError, setPeriodError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Chips
        items={pays.map(formatMinPay)}
        disabled={disabled}
        onRemove={(i) => onChange(pays.filter((_, j) => j !== i))}
      />
      <AddForm
        label="Add a minimum pay"
        disabled={disabled}
        onSubmit={() => {
          // Read with the separators amounts are shown in, never guessed (parseAmount).
          const parsed = parseAmount(amount);
          const currencyOk = CurrencyCodeSchema.safeParse(upper(currency)).success;
          setError(
            !parsed.ok
              ? parsed.message
              : !currencyOk
                ? "Use the three-letter currency code, like EUR or GBP"
                : null,
          );
          setPeriodError(period ? null : "Choose a period");
          if (!parsed.ok || !currencyOk || !period) return;
          const asWritten = `${amount.trim()} ${upper(currency)} ${formatPeriod(period)}`;
          onChange([
            ...pays,
            { amount: parsed.amount, currency: upper(currency), period, asWritten },
          ]);
          setAmount("");
          setCurrency("");
          setPeriod("");
        }}
      >
        <TextField
          label="Amount"
          inputMode="decimal"
          value={amount}
          disabled={disabled}
          error={error}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextField
          label="Currency code"
          value={currency}
          maxLength={3}
          disabled={disabled}
          onChange={(e) => setCurrency(e.target.value)}
        />
        <SelectField
          label="Period"
          value={period}
          disabled={disabled}
          error={periodError}
          onChange={(e) => setPeriod(e.target.value as PayPeriod | "")}
        >
          <option value="">Choose…</option>
          {PayPeriodSchema.options.map((p) => (
            <option key={p} value={p}>
              {formatPeriod(p)}
            </option>
          ))}
        </SelectField>
      </AddForm>
    </div>
  );
}

function PermitsEditor({ value, disabled, onChange }: EditorProps) {
  const permits = value as Permits;
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <Chips
        items={permits.map(formatPermit)}
        disabled={disabled}
        onRemove={(i) => onChange(permits.filter((_, j) => j !== i))}
      />
      <AddForm
        label="Add a work permit"
        disabled={disabled}
        onSubmit={() => {
          if (!text.trim()) return;
          onChange([...permits, { country: null, text: text.trim() }]);
          setText("");
        }}
      >
        <TextField
          label="Work permit, as you'd say it"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
        />
      </AddForm>
    </div>
  );
}

function ExtraEditor({
  question,
  ...props
}: EditorProps & { question: ExtraQuestion | undefined }) {
  const chosen = props.value as string[];
  const options = question?.options ?? [];
  const others = chosen.filter((c) => !options.includes(c));
  return (
    <div className="flex flex-col gap-3">
      {options.length > 0 && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Options for {props.label}</legend>
          {options.map((option) => (
            <Toggle
              key={option}
              label={option}
              pressed={chosen.includes(option)}
              disabled={props.disabled}
              onClick={() =>
                props.onChange(
                  chosen.includes(option)
                    ? chosen.filter((c) => c !== option)
                    : [...chosen, option],
                )
              }
            />
          ))}
        </fieldset>
      )}
      <WordsEditor
        {...props}
        label={options.length > 0 ? "Other answers" : props.label}
        value={others}
        onChange={(next) =>
          props.onChange([...chosen.filter((c) => options.includes(c)), ...(next as string[])])
        }
      />
    </div>
  );
}

/** The editor that fits the answer's key. */
export function AnswerEditor(
  props: EditorProps & { entryKey: ProfileKey; question?: ExtraQuestion },
) {
  const { entryKey, question, ...editor } = props;
  if (isExtraKey(entryKey)) return <ExtraEditor {...editor} question={question} />;
  switch (entryKey) {
    case "places":
      return <PlacesEditor {...editor} />;
    case "remote":
      return <RemoteEditor {...editor} />;
    case "min_pay":
      return <MinPayEditor {...editor} />;
    case "work_permits":
      return <PermitsEditor {...editor} />;
    case "reply_to":
      return <ReplyToEditor {...editor} />;
    default:
      return <WordsEditor {...editor} />;
  }
}
