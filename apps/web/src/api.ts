import { ApiErrorSchema } from "@jobfilly/schema";
import type { ZodType } from "zod";

// The UI talks to the server only over HTTP on the same origin: Vite proxies /api in development,
// and the server serves the UI itself everywhere else. Every answer is checked against its schema
// from @jobfilly/schema before the UI uses it.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const res = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: options.body === undefined ? {} : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = "Something went wrong. Try again.";
    try {
      const parsed = ApiErrorSchema.safeParse(await res.json());
      if (parsed.success) {
        code = parsed.data.error;
        message = parsed.data.message ?? message;
      }
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new ApiError(res.status, code, message);
  }
  return res;
}

/** Calls the API and parses the JSON answer with `schema`. */
export async function api<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const res = await send(path, options);
  return schema.parse(await res.json());
}

/** Calls the API for an answer without a body (204). */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await send(path, options);
}
