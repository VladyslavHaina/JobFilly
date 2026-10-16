import { Link } from "react-router";
import { Alert, Card } from "../../components";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import { errorText, useCvs } from "./queries";

// The CV prompt on the profile page (F2): the CVs this job search uses, with their tags, or a
// nudge to upload some, and the way to the CVs page. Every CV of the workspace belongs to its one
// profile in MVP 2 (a new upload is linked to it).

export function ProfileCvPrompt(props: { workspaceId: string; profileId: string }) {
  const { workspaceId } = props;
  const { can } = useWorkspace();
  const cvs = useCvs(workspaceId);
  if (cvs.isPending) return null;
  if (cvs.isError) return <Alert>{errorText(cvs.error)}</Alert>;
  const link = (
    <Link className="font-medium text-indigo-700 hover:underline" to={paths.cvs(workspaceId)}>
      {cvs.data.length === 0 ? "Upload CVs" : "Manage CVs"}
    </Link>
  );
  if (cvs.data.length === 0) {
    return (
      <Alert tone="info" title="Add your CVs">
        {can.edit
          ? "Upload the CVs you send, so every role gets the right one and drafts can attach it. "
          : "No CVs are uploaded yet. "}
        {link}
      </Alert>
    );
  }
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-stone-900">CVs</h2>
        {link}
      </div>
      <ul aria-label="CVs" className="flex flex-col gap-1 text-sm">
        {cvs.data.map((cv) => (
          <li key={cv.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-stone-800">{cv.name}</span>
            {cv.tags.length > 0 && (
              <span className="text-xs text-stone-500">
                {cv.tags.map((t) => t.label).join(" · ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
