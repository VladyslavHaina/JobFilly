import { describe, expect, it } from "vitest";
import { gapFrom, type RollingDeps, rollingRestart } from "./rolling-restart.ts";

// S10's rolling restart (MVP 3) against a fake stack: no Docker, no network.

interface Fake {
  deps: RollingDeps;
  /** The compose commands, with the clock when each ran. */
  restarts: { args: string[]; at: number }[];
  out: string[];
}

/**
 * A stack whose /api/auth/me answers `me(persona, clock)`, whose replicas are ready again right
 * after their restart, and whose clock moves only by sleeps.
 */
function fake(me: (cookie: string, clock: number) => number = () => 200): Fake {
  let clock = 0;
  const restarts: Fake["restarts"] = [];
  const out: string[] = [];
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/auth/sign-in") {
      const { email } = JSON.parse(String(init?.body)) as { email: string };
      return new Response("{}", {
        status: 200,
        headers: { "set-cookie": `jf_session=${email}; Path=/; HttpOnly` },
      });
    }
    if (url.pathname === "/api/auth/me") {
      const cookie = new Headers(init?.headers).get("cookie") ?? "";
      return new Response("{}", { status: me(cookie, clock) });
    }
    if (url.pathname === "/api/health/ready") return new Response("{}", { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return {
    restarts,
    out,
    deps: {
      compose: async (args) => {
        restarts.push({ args, at: clock });
        return 0;
      },
      fetch: fetchFake,
      sleep: (ms) => {
        clock += ms;
        return new Promise((r) => setImmediate(r));
      },
      now: () => clock,
      print: (line) => out.push(line),
    },
  };
}

describe("the rolling restart (S10)", () => {
  it("restarts app-a, app-b and app-c in turn, the gap apart, and passes when nothing failed", async () => {
    const f = fake();
    expect(await rollingRestart(f.deps, { gapMs: 10_000 })).toBe(0);
    expect(f.restarts.map((r) => r.args)).toEqual([
      ["restart", "app-a"],
      ["restart", "app-b"],
      ["restart", "app-c"],
    ]);
    // The poller's sleeps move the clock too, so each gap is at least the gap.
    const at = f.restarts.map((r) => r.at);
    expect((at[1] ?? 0) - (at[0] ?? 0)).toBeGreaterThanOrEqual(10_000);
    expect((at[2] ?? 0) - (at[1] ?? 0)).toBeGreaterThanOrEqual(10_000);
    expect(f.out).toContain("Signed out: nobody");
    expect(f.out.find((l) => l.startsWith("Requests through the proxy:"))).toMatch(
      /^Requests through the proxy: [1-9]\d*, failed: 0$/,
    );
  });

  it("reports every failed request and every sign-out, and fails", async () => {
    // Tom is signed out from 12 s on; one of Maria's requests gets a 502.
    let maria502 = false;
    const f = fake((cookie, clock) => {
      if (cookie.includes("tom.okafor") && clock >= 12_000) return 401;
      if (cookie.includes("maria.santos") && clock >= 5_000 && !maria502) {
        maria502 = true;
        return 502;
      }
      return 200;
    });
    expect(await rollingRestart(f.deps, { gapMs: 10_000 })).toBe(1);
    expect(f.out).toContain("Signed out: tom");
    expect(f.out.some((l) => / maria: 502$/.test(l))).toBe(true);
    expect(f.out.some((l) => / tom: 401$/.test(l))).toBe(true);
    expect(f.out.find((l) => l.startsWith("Requests through the proxy:"))).not.toMatch(
      /failed: 0$/,
    );
  });

  it("restarts nothing when a persona can't sign in", async () => {
    const f = fake();
    const deps: RollingDeps = {
      ...f.deps,
      fetch: (async () => new Response("{}", { status: 401 })) as typeof fetch,
    };
    expect(await rollingRestart(deps)).toBe(1);
    expect(f.restarts).toEqual([]);
  });

  it("reads --gap-seconds, defaulting to the scenario's 10 seconds", () => {
    expect(gapFrom([])).toBe(10_000);
    expect(gapFrom(["--gap-seconds", "3"])).toBe(3_000);
    expect(gapFrom(["--gap-seconds", "x"])).toBeNull();
    expect(gapFrom(["--other"])).toBeNull();
  });
});
