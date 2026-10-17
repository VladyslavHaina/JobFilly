// Merging the replicas' JSON logs into one, for specs/shared.ts. Each replica's log is in the
// order it wrote it, but requests land on any replica, so joining them replica by replica puts
// an "on" logged by app-a before an "off" logged earlier by app-b. A spec that checks an order
// needs them by `time` (the ISO timestamp every app line carries).

type Line = { [field: string]: unknown };

const timeOf = (line: Line): number => {
  const t = typeof line.time === "string" ? Date.parse(line.time) : Number.NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

/**
 * The lines of every log, ordered by their `time`. The sort is stable: lines with the same time
 * keep the order of `logs` (and within one log, the order it was written). A line without a
 * readable time goes last.
 */
export function mergeByTime<T extends Line>(logs: readonly (readonly T[])[]): T[] {
  return logs
    .flat()
    .map((line, i) => ({ line, i, t: timeOf(line) }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.i - b.i))
    .map(({ line }) => line);
}
