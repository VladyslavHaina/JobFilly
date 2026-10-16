import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useEscapeLayer } from "./layers";

// Small building blocks shared by every page, so the app looks and behaves the same everywhere.
// Every field has a visible label tied to its input, so people (and role-based tests) find it.

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
  secondary:
    "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 disabled:text-stone-400",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300",
  ghost: "text-stone-700 hover:bg-stone-100 disabled:text-stone-400",
};

export function Button({
  variant = "primary",
  busy = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
        "disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium text-stone-800">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cx(
          "rounded-md border bg-white px-3 py-2 text-sm text-stone-900 shadow-xs",
          "focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200",
          "disabled:bg-stone-100 disabled:text-stone-500",
          error ? "border-red-400" : "border-stone-300",
        )}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-xs text-stone-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium text-stone-800">
        {label}
      </label>
      <select
        id={id}
        className={cx(
          "rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900",
          "focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200",
          "disabled:bg-stone-100 disabled:text-stone-500",
        )}
        {...props}
      >
        {children}
      </select>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function Alert({
  tone = "error",
  title,
  children,
}: {
  tone?: "error" | "success" | "info" | "warning";
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    info: "border-indigo-200 bg-indigo-50 text-indigo-950",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("rounded-md border px-3.5 py-3 text-sm", tones[tone])}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-stone-200 bg-white p-5 shadow-xs", className)}>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-stone-600">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-stone-500">
      <Spinner /> {label}
    </p>
  );
}

/** A multi-line text field with its visible label (a draft's body, a message to the assistant). */
export function Textarea({
  label,
  hint,
  error,
  className,
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium text-stone-800">
        {label}
      </label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cx(
          "min-h-24 rounded-md border bg-white px-3 py-2 text-sm text-stone-900 shadow-xs",
          "focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200",
          "disabled:bg-stone-100 disabled:text-stone-500",
          error ? "border-red-400" : "border-stone-300",
        )}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-xs text-stone-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** An on/off switch (a rule on or off, F3.5): a button with role switch and its label. */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
  hideLabel = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Keep the label for screen readers only (the row already says what it is). */
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-indigo-600" : "bg-stone-300",
        )}
      >
        <span
          aria-hidden
          className={cx(
            "inline-block size-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </button>
      <span id={id} className={hideLabel ? "sr-only" : "text-sm text-stone-800"}>
        {label}
      </span>
    </span>
  );
}

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  info: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  danger: "bg-red-50 text-red-800 ring-red-200",
};

/**
 * A small status chip (a fit score, a sender verdict, a draft's status). `label` names it for
 * screen readers when the visible text alone wouldn't ("Fit score 72").
 */
export function Badge({
  tone = "neutral",
  label,
  children,
}: {
  tone?: BadgeTone;
  label?: string;
  children: ReactNode;
}) {
  const className = cx(
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
    BADGE_TONES[tone],
  );
  if (!label) return <span className={className}>{children}</span>;
  return (
    <span role="img" aria-label={label} className={className}>
      {children}
    </span>
  );
}

/**
 * Words as removable chips with a field to add more (a CV's tags, F2.1). Enter or a comma adds
 * what is typed; each chip has its own Remove button.
 */
export function TagInput({
  label,
  tags,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  tags: readonly string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const add = () => {
    const tag = text.trim().replace(/,$/, "").trim();
    setText("");
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    onChange([...tags, tag]);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-stone-800">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2 py-1.5">
        <ul aria-label={label} className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800"
            >
              {tag}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="rounded-full px-1 hover:bg-indigo-100 disabled:cursor-not-allowed"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <input
          id={id}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          className="min-w-24 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm focus:outline-none disabled:text-stone-500"
        />
      </div>
    </div>
  );
}

/**
 * A modal dialog (a proposal card's edit, a confirmation): labelled by its title, closed with Esc
 * or its Close button, focus moved into it when it opens and back when it closes.
 */
export function Dialog({
  title,
  open,
  onClose,
  children,
  actions,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => before?.focus?.();
  }, [open]);
  // Esc closes this dialog only, not the message or panel it opened over.
  useEscapeLayer(open, (e) => {
    e.preventDefault();
    onClose();
  });
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-lg border border-stone-200 bg-white p-5 shadow-lg focus:outline-none"
      >
        <header className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold text-stone-900">
            {title}
          </h2>
          <Button variant="ghost" className="px-2 py-1" aria-label="Close" onClick={onClose}>
            ×
          </Button>
        </header>
        <div className="mt-3 text-sm text-stone-700">{children}</div>
        {actions && <footer className="mt-5 flex justify-end gap-2">{actions}</footer>}
      </div>
    </div>
  );
}
