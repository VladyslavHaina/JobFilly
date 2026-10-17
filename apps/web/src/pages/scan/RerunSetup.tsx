import { MAX_SCAN_HINT_LENGTH, SCAN_WINDOW_DAYS } from "@jobfilly/schema";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { Alert, Button, Card, Textarea } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { scanActionError, useScanAction } from "./queries";

// Re-run setup (MVP 3, F1.1): an admin presses it, optionally types a hint ("I've moved to
// Germany, permanent roles only"), and the scan reads the last 90 days again with the hint in
// focus. Its intake form makes a new profile next to the others; they stay as they are. The scan
// page shows the run; once it stops, the intake form is the re-run's. Shown on the profile page.

export function RerunSetup({ workspaceId }: { workspaceId: string }) {
  const { can } = useWorkspace();
  const navigate = useNavigate();
  const action = useScanAction(workspaceId);
  const [hint, setHint] = useState<string | null>(null);
  if (!can.admin) return null;

  if (hint === null) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600">
          Life changed? Re-run setup to make another profile next to this one.
        </p>
        <Button variant="secondary" onClick={() => setHint("")}>
          Re-run setup
        </Button>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    action.mutate(
      { kind: "rerun", hint },
      { onSuccess: () => void navigate(paths.scan(workspaceId)) },
    );
  };
  const error = scanActionError(action.error);
  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-stone-900">Re-run setup</h2>
        <p className="text-sm text-stone-600">
          The scan reads the last {SCAN_WINDOW_DAYS} days of your mail again and proposes a new
          profile. Your profiles stay as they are.
        </p>
        <Textarea
          label="What changed? (optional)"
          hint="For example: I've moved to Germany, permanent roles only"
          value={hint}
          maxLength={MAX_SCAN_HINT_LENGTH}
          rows={3}
          onChange={(e) => setHint(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" busy={action.isPending}>
            Start the re-run
          </Button>
          <Button variant="ghost" onClick={() => setHint(null)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
