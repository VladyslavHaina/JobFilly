import { AI_BATCH_SIZE, type Envelope } from "@jobfilly/schema";

/** Newest first; ties broken by Message-ID (descending, as packages/db pages) so the order is stable. */
export function orderNewestFirst(envelopes: readonly Envelope[]): Envelope[] {
  return [...envelopes].sort((a, b) => {
    const byDate = Date.parse(b.date) - Date.parse(a.date);
    if (byDate !== 0) return byDate;
    return a.messageId < b.messageId ? 1 : a.messageId > b.messageId ? -1 : 0;
  });
}

/** Splits items into batches of `size` (20 by default, F4), keeping their order. */
export function toBatches<T>(items: readonly T[], size = AI_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
