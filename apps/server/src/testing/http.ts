import { createSession } from "@jobfilly/db";
import type { App } from "../app";
import { hashToken, newToken, SESSION_COOKIE } from "../auth/session";
import type { AppDeps } from "../deps";

// Requests against the app in tests, sent as the browser would: same Origin as PUBLIC_URL, with
// the session cookie of a signed-in user.

export interface TestClient {
  /** The Cookie header this client sends, if signed in. */
  cookie: string | undefined;
  request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response>;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  put(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  patch(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  delete(path: string, headers?: Record<string, string>): Promise<Response>;
}

/** A session for `user` straight in the database; returns the Cookie header value. */
export async function sessionCookie(deps: AppDeps, user: { id: string }): Promise<string> {
  const token = newToken();
  await createSession(deps.db, {
    userId: user.id,
    tokenHash: hashToken(token),
    now: deps.clock.now(),
  });
  return `${SESSION_COOKIE}=${token}`;
}

/** Reads the jf_session value a response sets, as a Cookie header value. */
export function cookieFrom(res: Response): string | undefined {
  const set = res.headers
    .getSetCookie()
    .filter((c) => c.startsWith(`${SESSION_COOKIE}=`))
    .at(-1);
  return set?.split(";")[0];
}

export function testClient(app: App, deps: AppDeps, cookie?: string): TestClient {
  const client: TestClient = {
    cookie,
    request(method, path, body, headers = {}) {
      return Promise.resolve(
        app.request(path, {
          method,
          headers: {
            Origin: deps.config.origin,
            ...(client.cookie ? { Cookie: client.cookie } : {}),
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
    },
    get: (path, headers) => client.request("GET", path, undefined, headers),
    post: (path, body, headers) => client.request("POST", path, body ?? {}, headers),
    put: (path, body, headers) => client.request("PUT", path, body ?? {}, headers),
    patch: (path, body, headers) => client.request("PATCH", path, body ?? {}, headers),
    delete: (path, headers) => client.request("DELETE", path, undefined, headers),
  };
  return client;
}

/** A client signed in as `user`. */
export async function signedIn(app: App, deps: AppDeps, user: { id: string }): Promise<TestClient> {
  return testClient(app, deps, await sessionCookie(deps, user));
}
