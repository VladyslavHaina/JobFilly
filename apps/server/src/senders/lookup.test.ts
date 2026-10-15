import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDeps, type SeededUser, seedUser, type TestDeps } from "../testing";
import { createDomainPort, lookupDomain } from "./lookup";

// The real DomainPort (RDAP through JOBFILLY_RDAP_URL, MX through a resolver) with a fake fetch
// and a fake resolver, and lookupDomain's cache in domain_lookups: nothing reaches the network.

const RDAP_URL = "https://rdap.test/";

function rdapAnswer(domain: string, registered: string | null) {
  return {
    objectClassName: "domain",
    ldhName: domain,
    events: [
      ...(registered ? [{ eventAction: "registration", eventDate: registered }] : []),
      { eventAction: "last changed", eventDate: "2026-01-01T00:00:00Z" },
    ],
  };
}

describe("the real DomainPort", () => {
  it("asks JOBFILLY_RDAP_URL for the domain and reads its registration date", async () => {
    const asked: string[] = [];
    const port = createDomainPort(
      { rdapUrl: "https://rdap.test" },
      {
        fetch: async (url) => {
          asked.push(String(url));
          return Response.json(rdapAnswer("tidewater.example", "2012-03-01T08:00:00Z"));
        },
      },
    );
    expect(await port.rdap("tidewater.example")).toEqual({
      registeredAt: "2012-03-01T08:00:00.000Z",
    });
    expect(asked).toEqual([`${RDAP_URL}domain/tidewater.example`]);
  });

  it("gives null for an answer without a registration date, and throws when RDAP fails", async () => {
    let status = 200;
    const port = createDomainPort(
      { rdapUrl: RDAP_URL },
      {
        fetch: async () =>
          status === 200
            ? Response.json(rdapAnswer("x.example", null))
            : new Response("", { status }),
      },
    );
    expect(await port.rdap("x.example")).toEqual({ registeredAt: null });
    status = 404;
    await expect(port.rdap("x.example")).rejects.toThrow("RDAP answered 404");
    status = 503;
    await expect(port.rdap("x.example")).rejects.toThrow();
  });

  it("fails on purpose when the answer isn't an RDAP domain object", async () => {
    let body: unknown = { events: { eventAction: "registration" } };
    const port = createDomainPort(
      { rdapUrl: RDAP_URL },
      { fetch: async () => Response.json(body) },
    );
    await expect(port.rdap("x.example")).rejects.toThrow("RDAP answered something else");
    body = { events: [{ eventAction: "registration", eventDate: 20120301 }] };
    await expect(port.rdap("x.example")).rejects.toMatchObject({ name: "RdapAnswerError" });
    body = { ldhName: "x.example" };
    expect(await port.rdap("x.example")).toEqual({ registeredAt: null });
  });

  it("reads MX records, and tells 'none' apart from a failed lookup", async () => {
    const answers: Record<string, () => Promise<{ exchange: string; priority: number }[]>> = {
      "mail.example": async () => [
        { exchange: "mx1.mail.example", priority: 10 },
        { exchange: "mx2.mail.example", priority: 20 },
      ],
      "nullmx.example": async () => [{ exchange: "", priority: 0 }],
      "nodata.example": async () =>
        Promise.reject(Object.assign(new Error("x"), { code: "ENODATA" })),
      "nxdomain.example": async () =>
        Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })),
      "timeout.example": async () =>
        Promise.reject(Object.assign(new Error("x"), { code: "ETIMEOUT" })),
    };
    const port = createDomainPort(
      { rdapUrl: RDAP_URL },
      { resolveMx: (domain) => (answers[domain] ?? (() => Promise.resolve([])))() },
    );
    expect(await port.mx("mail.example")).toEqual(["mx1.mail.example", "mx2.mail.example"]);
    expect(await port.mx("nullmx.example")).toEqual([]);
    expect(await port.mx("nodata.example")).toEqual([]);
    expect(await port.mx("nxdomain.example")).toEqual([]);
    await expect(port.mx("timeout.example")).rejects.toThrow();
  });
});

describe("lookupDomain's cache (domain_lookups)", () => {
  let deps: TestDeps;
  let maria: SeededUser;
  let tom: SeededUser;
  beforeEach(async () => {
    deps = await createTestDeps();
    maria = await seedUser(deps);
    tom = await seedUser(deps);
  });
  afterEach(() => deps.close());

  it("looks a domain up once per workspace and serves it from the cache", async () => {
    deps.domains.setRdap("tidewater.example", { registeredAt: "2012-03-01T00:00:00.000Z" });
    deps.domains.setMx("tidewater.example", ["mx.tidewater.example"]);
    const first = await lookupDomain(deps, maria.workspaceId, "tidewater.example", deps.log);
    const again = await lookupDomain(deps, maria.workspaceId, "tidewater.example", deps.log);
    expect(first).toEqual({
      rdap: { registeredAt: "2012-03-01T00:00:00.000Z" },
      mx: ["mx.tidewater.example"],
    });
    expect(again).toEqual(first);
    expect(deps.domains.calls).toEqual({ rdap: ["tidewater.example"], mx: ["tidewater.example"] });
    // Another workspace has its own cache.
    await lookupDomain(deps, tom.workspaceId, "tidewater.example", deps.log);
    expect(deps.domains.calls.rdap).toHaveLength(2);
  });

  it("asks again once an answer has expired", async () => {
    await lookupDomain(deps, maria.workspaceId, "tidewater.example", deps.log);
    deps.clock.advance(25 * 60 * 60 * 1000);
    await lookupDomain(deps, maria.workspaceId, "tidewater.example", deps.log);
    // MX answers are kept a day, RDAP answers a month.
    expect(deps.domains.calls.mx).toHaveLength(2);
    expect(deps.domains.calls.rdap).toHaveLength(1);
  });

  it("reports a failed lookup as failed, logs sender.lookup_incomplete, and retries later", async () => {
    deps.domains.setRdap("flaky.example", "fail");
    deps.domains.setMx("flaky.example", "fail");
    const facts = await lookupDomain(deps, maria.workspaceId, "flaky.example", deps.log);
    expect(facts).toEqual({ rdap: "failed", mx: "failed" });
    const warned = deps.logs.filter((l) => l.event === "sender.lookup_incomplete");
    expect(warned.map((l) => [l.level, l.kind, l.cached])).toEqual([
      ["warn", "rdap", false],
      ["warn", "mx", false],
    ]);
    expect(deps.rawLogs.join("\n")).not.toContain("flaky.example");

    // Within the next minutes the failure is served from the cache, without a new lookup.
    expect(await lookupDomain(deps, maria.workspaceId, "flaky.example", deps.log)).toEqual(facts);
    expect(deps.domains.calls.rdap).toHaveLength(1);

    deps.clock.advance(16 * 60 * 1000);
    deps.domains.setRdap("flaky.example", { registeredAt: "2015-01-01T00:00:00.000Z" });
    deps.domains.setMx("flaky.example", ["mx.flaky.example"]);
    expect(await lookupDomain(deps, maria.workspaceId, "flaky.example", deps.log)).toEqual({
      rdap: { registeredAt: "2015-01-01T00:00:00.000Z" },
      mx: ["mx.flaky.example"],
    });
  });

  it("keeps a failure that repeats twice as long each time, up to a day", async () => {
    deps.domains.setRdap("nordap.example", "fail");
    const ask = () => lookupDomain(deps, maria.workspaceId, "nordap.example", deps.log);
    const minute = 60 * 1000;
    await ask();
    for (const kept of [15, 30, 60]) {
      deps.clock.advance((kept - 1) * minute);
      await ask();
      deps.clock.advance(2 * minute);
      await ask();
    }
    // Asked at 0, 16 (kept 15), 47 (kept 30) and 108 minutes (kept 60), each from the cache between.
    expect(deps.domains.calls.rdap).toHaveLength(4);
    // A failure that has been kept a day stays kept a day.
    for (let i = 0; i < 6; i++) {
      deps.clock.advance(25 * 60 * minute);
      await ask();
    }
    deps.clock.advance(23 * 60 * minute);
    await ask();
    expect(deps.domains.calls.rdap).toHaveLength(10);
  });
});
