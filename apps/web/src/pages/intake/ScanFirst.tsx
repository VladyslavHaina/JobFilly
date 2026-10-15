import { Link } from "react-router";
import { useWorkspace } from "../../hooks";
import { paths } from "../../paths";
import type { FirstScan } from "./queries";

// What the intake form and the profile page say before the first scan has stopped: why they are
// empty, and the next step for this member. Only admins start a scan (F4.1), so the others are
// told who does, and still get a way to follow it.

const linkClass = "font-medium underline";

export function ScanFirst({
  workspaceId,
  firstScan,
}: {
  workspaceId: string;
  firstScan: FirstScan | null;
}) {
  const { can } = useWorkspace();
  let text: string | null = null;
  let link = "Go to the scan";
  if (firstScan === "none") {
    text = can.admin
      ? "No scan has run yet. Start it once your mailbox and AI are set up."
      : "No scan has run yet. An admin of this workspace starts it.";
    link = can.admin ? "Start the first scan" : "See the scan";
  } else if (firstScan === "running") {
    text = "The first scan is still reading your mail.";
  }
  return (
    <>
      {text && `${text} `}
      <Link className={linkClass} to={paths.scan(workspaceId)}>
        {link}
      </Link>
    </>
  );
}
