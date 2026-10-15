import type { AiClient } from "@jobfilly/ai";
import { recordAiUsage } from "@jobfilly/db";
import type { AiClientSettings, Usage } from "@jobfilly/schema";
import type { AppDeps } from "./deps";

// The one place the server records model usage (F1.5: model calls and tokens per day; MVP 1
// F3.6: per scan run). Every AI call goes through a client from aiClientFor, never through
// deps.ai.client directly: each task's result carries the usage of every request it made,
// retries included, and the client records each one with the clock's time before handing the
// result back, whether the task succeeded or not. A task added to AiClient must be added here,
// or this file stops compiling.

export interface AiClientScope {
  /** The scan run the calls belong to; null outside a run. */
  scanId?: string | null;
}

/** A client for the workspace's settings that records the usage of every call it makes. */
export function aiClientFor(
  deps: AppDeps,
  workspaceId: string,
  settings: AiClientSettings,
  scope: AiClientScope = {},
): AiClient {
  const client = deps.ai.client(settings);
  const recorded = async <T extends { usage: Usage[] }>(call: Promise<T>): Promise<T> => {
    const result = await call;
    for (const usage of result.usage) {
      await recordAiUsage(deps.db, workspaceId, {
        scanId: scope.scanId ?? null,
        task: usage.task,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        at: deps.clock.now(),
      });
    }
    return result;
  };
  return {
    classify: (items, options) => recorded(client.classify(items, options)),
    extract: (item, options) => recorded(client.extract(item, options)),
    prefs: (items, options) => recorded(client.prefs(items, options)),
    intake: (input, options) => recorded(client.intake(input, options)),
    test: () => recorded(client.test()),
    readCv: (input, options) => recorded(client.readCv(input, options)),
    match: (input, options) => recorded(client.match(input, options)),
    draft: (input, options) => recorded(client.draft(input, options)),
    assistant: (input, options) => recorded(client.assistant(input, options)),
  };
}
