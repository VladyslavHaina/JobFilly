import type { LiveEvent } from "@jobfilly/schema";
import type { AppDeps } from "../deps";

// How the assistant's services (./service, ./history) answer their routes: data, or a refusal
// with its HTTP status and body. Work that must be all or nothing runs in one transaction, and a
// refusal inside it rolls everything back.

/** A refusal with its HTTP status and body. */
interface Failure {
  ok: false;
  status: 400 | 404 | 409 | 502;
  body: { error: string; message?: string };
}
export type Result<T> = { ok: true; data: T } | Failure;

/** A refusal with `status` and the error code, and plain words when there are any. */
export const fail = (status: Failure["status"], error: string, message?: string): Failure => ({
  ok: false,
  status,
  body: message ? { error, message } : { error },
});

/** The refusal for anything the workspace or the member doesn't have: 404 not_found. */
export const NOT_FOUND_FAILURE = fail(404, "not_found");

class Refused extends Error {
  constructor(readonly failure: Failure) {
    super(failure.body.error);
  }
}

/**
 * Runs `work` in one transaction with dependencies on it, and sends the live events it publishes
 * only once it committed, so no browser refetches before the change is there. A refusal thrown
 * inside (refuse) rolls everything back and is returned.
 */
export async function inTransaction<T>(
  deps: AppDeps,
  work: (tx: AppDeps) => Promise<T>,
): Promise<Result<T>> {
  const events: [string, LiveEvent][] = [];
  try {
    const data = await deps.db.transaction((db) =>
      work({
        ...deps,
        db,
        live: {
          ...deps.live,
          publish: async (workspaceId, event) => {
            events.push([workspaceId, event]);
          },
        },
      }),
    );
    for (const [workspaceId, event] of events) await deps.live.publish(workspaceId, event);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof Refused) return error.failure;
    throw error;
  }
}

/** Refuses the transaction's work with `failure`. */
export function refuse(failure: Failure): never {
  throw new Refused(failure);
}
