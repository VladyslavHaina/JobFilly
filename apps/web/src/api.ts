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

async function send(path: string, options: RequestOptions, form?: FormData): Promise<Response> {
  const json = form === undefined && options.body !== undefined;
  const res = await fetch(path, {
    method: options.method ?? (form ? "POST" : "GET"),
    credentials: "same-origin",
    // A FormData body sets its own multipart Content-Type, with the boundary.
    headers: json ? { "Content-Type": "application/json" } : {},
    body: form ?? (json ? JSON.stringify(options.body) : undefined),
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

/**
 * Uploads a form as multipart/form-data (a CV file, F2.1) and parses the JSON answer with
 * `schema`. The browser sets the Content-Type with its boundary; no JSON type is sent.
 */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  schema: ZodType<T>,
  options: Omit<RequestOptions, "body"> = {},
): Promise<T> {
  const res = await send(path, { method: "POST", ...options }, form);
  return schema.parse(await res.json());
}

/** The file name a download's Content-Disposition gives, if any (RFC 6266, filename* first). */
function fileNameOf(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // Not valid percent-encoding: fall back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition);
  return plain?.[1]?.trim() ?? null;
}

/** Downloads a file (a CV, F2): its bytes and the name the server gives it. */
export async function apiDownload(
  path: string,
  options: Pick<RequestOptions, "signal"> = {},
): Promise<{ blob: Blob; fileName: string | null }> {
  const res = await send(path, options);
  return { blob: await res.blob(), fileName: fileNameOf(res.headers.get("Content-Disposition")) };
}
