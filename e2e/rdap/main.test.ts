import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findDomain, readDomains } from "./domains.ts";
import { createRdapServer, rdapReply } from "./main.ts";

// The fake RDAP service (e2e/rdap/main.ts on 8080 in the test stack), unit-tested on its answers
// and once over HTTP on a free port.

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-15T12:00:00.000Z");
const domains = {
  domains: {
    "kiezwerk.example": { registeredDaysAgo: 3000 },
    "quickhire-global.example": { registeredDaysAgo: 6 },
    "nhs.uk": { registeredDaysAgo: 9000 },
  },
};
const lines: Record<string, unknown>[] = [];
const options = { domains, log: (l: Record<string, unknown>) => lines.push(l), now: () => NOW };

interface DomainObject {
  objectClassName: string;
  ldhName: string;
  events: { eventAction: string; eventDate: string }[];
  rdapConformance: string[];
}

const registration = (body: unknown) =>
  (body as DomainObject).events.find((e) => e.eventAction === "registration")?.eventDate;

describe("rdapReply", () => {
  it("answers a listed domain with an RFC 9083 domain object registered its age before now", () => {
    const reply = rdapReply("/domain/quickhire-global.example", options);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      objectClassName: "domain",
      ldhName: "quickhire-global.example",
      rdapConformance: ["rdap_level_0"],
      status: ["active"],
    });
    expect(registration(reply.body)).toBe(new Date(NOW.getTime() - 6 * DAY_MS).toISOString());
  });

  it("finds a name case-insensitively, and a subdomain under its listed domain", () => {
    expect(rdapReply("/domain/KIEZWERK.example", options).status).toBe(200);
    const sub = rdapReply("/domain/jobs.nhs.uk", options);
    expect(sub.status).toBe(200);
    expect((sub.body as DomainObject).ldhName).toBe("nhs.uk");
    expect(registration(sub.body)).toBe(new Date(NOW.getTime() - 9000 * DAY_MS).toISOString());
  });

  it("answers an unlisted domain 404 with an RDAP error, and logs it", () => {
    const reply = rdapReply("/domain/unknown.example", options);
    expect(reply.status).toBe(404);
    expect(reply.body).toMatchObject({ errorCode: 404, title: "Not Found" });
    expect(lines.at(-1)).toMatchObject({ event: "rdap.not_found", domain: "unknown.example" });
  });

  it("refuses a path that is no domain query", () => {
    expect(rdapReply("/entity/x", options).status).toBe(400);
    expect(rdapReply("/domain/", options).status).toBe(400);
  });

  it("never answers a bare top-level domain from a listed domain", () => {
    expect(findDomain(domains, "example")).toBeNull();
    expect(findDomain(domains, "uk")).toBeNull();
  });
});

describe("the committed domains.json", () => {
  it("is readable and lists domains in lower case with a whole number of days", () => {
    const file = readDomains();
    expect(Object.keys(file.domains).length).toBeGreaterThan(50);
    for (const [domain, entry] of Object.entries(file.domains)) {
      expect(domain).toBe(domain.toLowerCase());
      expect(Number.isInteger(entry.registeredDaysAgo) && entry.registeredDaysAgo > 0).toBe(true);
    }
  });
});

describe("the RDAP server", () => {
  const server = createRdapServer(options);
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it("serves domain objects as application/rdap+json", async () => {
    const response = await fetch(`${base}/domain/kiezwerk.example`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/rdap+json");
    expect(((await response.json()) as DomainObject).ldhName).toBe("kiezwerk.example");
  });

  it("answers its health check and refuses anything but GET", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/domain/kiezwerk.example`, { method: "POST" })).status).toBe(405);
  });
});
