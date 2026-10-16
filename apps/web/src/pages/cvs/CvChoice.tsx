import { CvChoiceSchema, type CvChoice as CvChoiceValue } from "@jobfilly/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { Alert, SelectField } from "../../components";
import { queryKeys, useWorkspace } from "../../hooks";
import { apiPaths } from "../../paths";
import { errorText, useCvs } from "./queries";

// Each role's CV (F2.3): the CV the app would use and why ("German backend role → Backend (DE)"),
// or the one an editor chose. Editors change it for this role; viewers read it.

const AUTO = "";

export function CvChoice(props: {
  workspaceId: string;
  messageId: string;
  position: number;
  /** The CV the app would use, or the editor's; null until chosen. */
  choice: CvChoiceValue | null;
}) {
  const { workspaceId, messageId, position, choice } = props;
  const { can } = useWorkspace();
  const client = useQueryClient();
  const cvs = useCvs(workspaceId);
  const change = useMutation({
    mutationFn: (cvId: string | null) =>
      api(apiPaths.roleCv(workspaceId, messageId, position), CvChoiceSchema.nullable(), {
        method: "PUT",
        body: { cvId },
      }),
    // The role is re-evaluated with it; the message's detail shows the outcome.
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.area(workspaceId, "messages") }),
  });
  const shown = change.isSuccess ? change.data : choice;
  let reason = shown?.reason ?? "Not chosen yet: the role hasn't been evaluated.";
  if (change.isSuccess && change.data === null) {
    reason = "Back to automatic: the CV is chosen again in a moment.";
  }
  const list = cvs.data ?? [];
  return (
    <section aria-label={`CV for role ${position + 1}`} className="flex flex-col gap-1.5 text-sm">
      <p className="text-stone-700">
        <span className="font-medium text-stone-900">CV: </span>
        {reason}
      </p>
      {can.edit && list.length > 0 && (
        <SelectField
          label={`Use another CV for role ${position + 1}`}
          value={shown?.source === "you" && shown.cvId ? shown.cvId : AUTO}
          disabled={change.isPending}
          onChange={(e) => change.mutate(e.target.value === AUTO ? null : e.target.value)}
        >
          <option value={AUTO}>Choose automatically</option>
          {list.map((cv) => (
            <option key={cv.id} value={cv.id}>
              {cv.name}
            </option>
          ))}
        </SelectField>
      )}
      {change.isError && <Alert>{errorText(change.error)}</Alert>}
    </section>
  );
}
