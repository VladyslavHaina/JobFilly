import type { Role, WorkspaceSummary } from "@jobfilly/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, type RouteObject } from "react-router";
import { vi } from "vitest";
import { App, createQueryClient } from "../App";
import { WorkspaceProvider } from "../hooks";
import { routes } from "../routes";

// Test support for the web app: a fake API behind fetch, and renderers with the providers the
// pages expect. No test reaches a server.

export interface FakeRequest {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
}

/** Answers "METHOD /path" (exact, or with :params): a JSON body, a Response, or a function. */
export type FakeRoutes = Record<
  string,
  unknown | Response | ((req: FakeRequest, params: Record<string, string>) => unknown | Response)
>;

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const p = a[i] ?? "";
    const v = b[i] ?? "";
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(v);
    else if (p !== v) return null;
  }
  return params;
}

/** Replaces fetch with the routes; anything else answers 404. Returns the requests seen. */
export function fakeApi(routes: FakeRoutes): FakeRequest[] {
  const seen: FakeRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        String(input instanceof Request ? input.url : input),
        "http://jobfilly.test",
      );
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const req: FakeRequest = { method, path: url.pathname, search: url.searchParams, body };
      seen.push(req);
      for (const [key, answer] of Object.entries(routes)) {
        const [m, pattern] = key.split(" ");
        if (m !== method || !pattern) continue;
        const params = match(pattern, url.pathname);
        if (!params) continue;
        const value = typeof answer === "function" ? await answer(req, params) : answer;
        if (value instanceof Response) return value;
        if (value === undefined) return new Response(null, { status: 204 });
        return Response.json(value);
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    }),
  );
  return seen;
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const TEST_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Maria Santos",
  email: "maria.santos@inbox.example",
};

export function testWorkspace(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    name: "Maria's workspace",
    ownerId: TEST_USER.id,
    role: "admin",
    isOwner: true,
    ...overrides,
  };
}

/** Renders the whole app at `path` with a memory router. */
export function renderApp(path: string, appRoutes: RouteObject[] = routes) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  const result = render(<App router={router} queryClient={queryClient} />);
  return { ...result, router, queryClient };
}

/** Renders one page inside a workspace with the given role, for the slices' page tests. */
export function renderInWorkspace(
  ui: ReactNode,
  options: { role?: Role; workspace?: Partial<WorkspaceSummary>; path?: string } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const workspace = testWorkspace({ role: options.role ?? "admin", ...options.workspace });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options.path ?? "/"]}>
        <WorkspaceProvider workspace={workspace}>{ui}</WorkspaceProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient, workspace };
}
