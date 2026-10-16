/** A base no real page has: only a path that stays on it is an in-app path. */
const BASE = "http://app.invalid";

/**
 * Where to go after signing in: the ?next path if it is an in-app path, else null (home). It is
 * read as the browser would, so "/\evil.example" or "/<tab>/evil.example", which the browser
 * takes for "//evil.example", is refused like "//evil.example" itself.
 */
export function nextPath(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  if (!next?.startsWith("/")) return null;
  const url = new URL(next, BASE);
  return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : null;
}
