import type { JobRegistry } from "../jobs/queue";

// The mail.sync job (F1): one sync of one mailbox, dedupe key sync:<mailboxId>. Registered here,
// spread into jobs/registry.ts; the mailbox slice adds it.
export const syncJobs: JobRegistry = {};
