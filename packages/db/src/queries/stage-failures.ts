import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { type Database, queryRows } from "../client";
import { stageFailures } from "../tables";
import type { StaleScope } from "./evaluations";

// Pipeline stages that keep failing (ARCHITECTURE › The analysis pipeline). A failing sender
// check or role (its cv-choice or match stage) is tried again at the next sweep after its first
// failure, then waits a back-off that doubles from one sync interval up to a cap, so a
// deterministic failure (a provider that refuses, a stage that can't work) doesn't repeat its
// model and mailbox calls and its log lines on every tick. The back-off lives in the database
// (stage_failures), so every replica agrees, and is read with the caller's clock.
//
//   recordStageFailure  counts a failure and sets when the item may be tried again
//   clearStageFailure   forgets it once the stage succeeds
//   clearStageFailures  ends the wait of the roles a change re-evaluates (requestReevaluation)
//   getStageHolds       what of one message is still waiting out its back-off
//
// A change that marks the item stale again (a sender mark for a check, a profile, rule, CV,
// decision or category change for a role) ends its wait at once: it is a new question. listTo-
// Evaluate (./evaluations.ts) leaves held items out with the same conditions (senderHeldSql,
// roleHeldSql); those two are SQL, so the package index doesn't export them.

/** A sender check, or one role's evaluation (its cv-choice and match stages). */
export type FailedStage =
  | { messageId: string; stage: "sender" }
  | { messageId: string; stage: "match"; position: number };

/** The back-off: none after the first failure, then `intervalMs` doubling up to `capMs`. */
export interface BackOff {
  intervalMs: number;
  capMs: number;
}

/** The position a sender check is stored under (it belongs to the message, not a role). */
const SENDER_POSITION = -1;

const positionOf = (ref: FailedStage) => (ref.stage === "sender" ? SENDER_POSITION : ref.position);

/**
 * Counts one more failure of the stage and sets when it may run again: at once after the first
 * (the next sweep), then failed_at + interval × 2^(failures - 2), at most the cap (never less
 * than one interval). A role's row keeps its evaluation's stale_since as it was, so a later
 * change is told apart. Returns the count and the retry time.
 */
export async function recordStageFailure(
  db: Database,
  workspaceId: string,
  ref: FailedStage,
  options: BackOff & { now: Date },
): Promise<{ failures: number; retryAt: Date }> {
  const position = positionOf(ref);
  const staleSince =
    ref.stage === "match"
      ? sql`(select stale_since from role_evaluations
            where workspace_id = ${workspaceId} and message_id = ${ref.messageId}
              and position = ${position})`
      : null;
  const cap = Math.max(options.capMs, options.intervalMs);
  const [row] = await db
    .insert(stageFailures)
    .values({
      workspaceId,
      messageId: ref.messageId,
      stage: ref.stage,
      position,
      failures: 1,
      failedAt: options.now,
      retryAt: options.now,
      staleSince,
    })
    .onConflictDoUpdate({
      target: [
        stageFailures.workspaceId,
        stageFailures.messageId,
        stageFailures.stage,
        stageFailures.position,
      ],
      set: {
        // The existing row's count, qualified (an unqualified name is ambiguous here).
        failures: sql`stage_failures.failures + 1`,
        failedAt: sql`excluded.failed_at`,
        // The new count is failures + 1, so its wait is interval × 2^(failures - 1), capped.
        retryAt: sql`excluded.failed_at + least(${cap}::double precision,
          ${options.intervalMs}::double precision
            * power(2, least(stage_failures.failures - 1, 30))) * interval '1 millisecond'`,
        staleSince: sql`excluded.stale_since`,
      },
    })
    .returning({ failures: stageFailures.failures, retryAt: stageFailures.retryAt });
  if (!row) throw new Error("recordStageFailure: nothing was written");
  return row;
}

/** Forgets the stage's failures: it succeeded (or its item is settled another way). */
export async function clearStageFailure(
  db: Database,
  workspaceId: string,
  ref: FailedStage,
): Promise<void> {
  await db
    .delete(stageFailures)
    .where(
      and(
        eq(stageFailures.workspaceId, workspaceId),
        eq(stageFailures.messageId, ref.messageId),
        eq(stageFailures.stage, ref.stage),
        eq(stageFailures.position, positionOf(ref)),
      ),
    );
}

/**
 * Ends the wait of the roles a change re-evaluates (requestReevaluation calls it with the scope
 * it marks stale): a role that never had an evaluation has no stale flag to show the change.
 * A sender scope ends nothing here: it makes the sender checks and the evaluations stale, which
 * ends their wait already.
 */
export async function clearStageFailures(
  db: Database,
  workspaceId: string,
  scope: StaleScope,
): Promise<void> {
  let filter: SQL | undefined;
  if ("roles" in scope) {
    if (scope.roles.length === 0) return;
    filter = or(
      ...scope.roles.map((r) =>
        and(eq(stageFailures.messageId, r.messageId), eq(stageFailures.position, r.position)),
      ),
    );
  } else if ("messageIds" in scope) {
    if (scope.messageIds.length === 0) return;
    filter = inArray(stageFailures.messageId, [...scope.messageIds]);
  } else if (!("all" in scope)) {
    return;
  }
  await db
    .delete(stageFailures)
    .where(
      and(eq(stageFailures.workspaceId, workspaceId), eq(stageFailures.stage, "match"), filter),
    );
}

const iso = (now: Date) => sql`${now.toISOString()}::timestamptz`;

/**
 * SQL: the sender failure row `f` still holds its message's check at `now` (`sc` is the
 * message's sender_checks row). A failed check is stored current, so it is stale again only
 * after a change made since.
 */
export function senderHeldSql(f: string, sc: string, now: Date): SQL {
  return sql`(${sql.raw(f)}.message_id is not null and ${sql.raw(f)}.retry_at > ${iso(now)}
    and not coalesce(${sql.raw(sc)}.stale, false))`;
}

/**
 * SQL: the role failure row `f` still holds its role at `now` (`e` is the role's evaluation):
 * its retry time hasn't come and the evaluation wasn't marked stale since it failed.
 */
export function roleHeldSql(f: string, e: string, now: Date): SQL {
  const [ff, ee] = [sql.raw(f), sql.raw(e)];
  return sql`(${ff}.message_id is not null and ${ff}.retry_at > ${iso(now)}
    and not coalesce(${ee}.stale and ${ee}.stale_since is distinct from ${ff}.stale_since, false))`;
}

/** What of one message waits out its back-off at `now`: its sender check, and which roles. */
export interface StageHolds {
  sender: boolean;
  positions: number[];
}

export async function getStageHolds(
  db: Database,
  workspaceId: string,
  messageId: string,
  now: Date,
): Promise<StageHolds> {
  const rows = await queryRows<{ stage: "sender" | "match"; position: number }>(
    db,
    sql`select f.stage, f.position from stage_failures f
      left join sender_checks sc
        on sc.workspace_id = f.workspace_id and sc.message_id = f.message_id
      left join role_evaluations e on e.workspace_id = f.workspace_id
        and e.message_id = f.message_id and e.position = f.position
      where f.workspace_id = ${workspaceId} and f.message_id = ${messageId}
        and case when f.stage = 'sender' then ${senderHeldSql("f", "sc", now)}
          else ${roleHeldSql("f", "e", now)} end
      order by f.position`,
  );
  return {
    sender: rows.some((r) => r.stage === "sender"),
    positions: rows.filter((r) => r.stage === "match").map((r) => Number(r.position)),
  };
}
