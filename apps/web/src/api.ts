import type { AppType } from "@jobfilly/server";
import { hc } from "hono/client";

// Typed client for the server API. The UI is always served from the same
// origin as the API: Vite proxies /api in development, and the server serves
// the UI itself everywhere else.
export const api = hc<AppType>(globalThis.location.origin);
