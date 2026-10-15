// The first scan's decisions without I/O (F4): stage-one sorting from headers, candidate order,
// batches, and the confidence tracker with its stop rules. The scan worker in apps/server does
// the mail, model and database work around them.

export { orderNewestFirst, toBatches } from "./batches";
export { loadJobPlatforms } from "./platforms";
export { stageOne } from "./stage-one";
export { type ConfidenceTracker, createConfidenceTracker, stopMessage } from "./tracker";
