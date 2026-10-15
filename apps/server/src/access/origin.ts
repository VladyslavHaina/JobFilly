import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";

// State-changing requests must come from the server's own origin (F1.10): a POST, PUT, PATCH or
// DELETE whose Origin header isn't PUBLIC_URL's origin, or that has none, is refused.

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function originCheck(origin: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (UNSAFE.has(c.req.method) && c.req.header("Origin") !== origin) {
      return c.json(
        { error: "bad_origin", message: "This request must come from JobFilly itself" },
        403,
      );
    }
    await next();
  };
}
