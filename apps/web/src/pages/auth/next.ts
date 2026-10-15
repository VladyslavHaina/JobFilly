/** Where to go after signing in: the ?next path if it is an in-app path, else home. */
export function nextPath(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : null;
}
