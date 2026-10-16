import { listWorkspacesWithFailedLookups, markFailedLookupChecksStale } from "@jobfilly/db";
import type { AppDeps } from "../deps";

// Checks whose domain lookup failed (F5.3) are done again on their own: a failed RDAP or DNS
// lookup leaves the check incomplete ("Caution, incomplete"), and once the failure has left the
// lookup cache (./lookup.ts keeps it 15 minutes, longer each time it repeats), the sweep marks
// that check stale, so the next pipeline run of the workspace checks the message again. The
// sweep (pipeline/sweep.ts) calls this before it looks for workspaces with work.

/** Marks the checks to look up again stale in every workspace; returns how many. */
export async function retryFailedLookups(deps: Pick<AppDeps, "db" | "clock" | "log">) {
  const now = deps.clock.now();
  let total = 0;
  for (const workspaceId of await listWorkspacesWithFailedLookups(deps.db, now)) {
    const checks = await markFailedLookupChecksStale(deps.db, workspaceId, now);
    if (checks > 0) deps.log.info("sender.lookup_retry", { workspaceId, checks });
    total += checks;
  }
  return total;
}
