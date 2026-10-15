import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type DomainsFile, findDomain, readDomains } from "./domains.ts";

// The fake RDAP service of the test stack (MVP 2, F5): node e2e/rdap/main.ts
//   PORT  listen port (8080; 0 takes any free port)
// It answers from e2e/rdap/domains.json.
// The app reads a sender domain's age through JOBFILLY_RDAP_URL=http://rdap:8080, the way it
// asks rdap.org: GET /domain/<name> answers an RFC 9083 domain object whose registration event
// is the domain's age before now; a domain the fixtures don't list is 404, as a registry says.

const DAY_MS = 24 * 60 * 60 * 1000;
const RDAP_JSON = "application/rdap+json";

export interface RdapOptions {
  domains: DomainsFile;
  log: (line: Record<string, unknown>) => void;
  now?: () => Date;
}

interface Reply {
  status: number;
  body: unknown;
}

/** The answer to a GET of `path`. */
export function rdapReply(path: string, options: RdapOptions): Reply {
  if (path === "/health") return { status: 200, body: { ok: true } };
  const match = /^\/domain\/([^/]+)$/.exec(path);
  if (!match) {
    return { status: 400, body: rdapError(400, "Bad request", `no RDAP query ${path}`) };
  }
  const name = decodeURIComponent(match[1] as string).toLowerCase();
  const found = findDomain(options.domains, name);
  if (!found) {
    options.log({ level: "info", event: "rdap.not_found", domain: name });
    return { status: 404, body: rdapError(404, "Not Found", `${name} is not registered`) };
  }
  const now = (options.now ?? (() => new Date()))();
  const registered = new Date(now.getTime() - found.registeredDaysAgo * DAY_MS);
  const expires = new Date(now.getTime() + 365 * DAY_MS);
  options.log({ level: "info", event: "rdap.answered", domain: name });
  return {
    status: 200,
    body: {
      rdapConformance: ["rdap_level_0"],
      objectClassName: "domain",
      handle: `E2E-${found.domain.toUpperCase().replace(/\./g, "-")}`,
      ldhName: found.domain,
      status: ["active"],
      events: [
        { eventAction: "registration", eventDate: registered.toISOString() },
        { eventAction: "expiration", eventDate: expires.toISOString() },
      ],
    },
  };
}

function rdapError(errorCode: number, title: string, description: string) {
  return { rdapConformance: ["rdap_level_0"], errorCode, title, description: [description] };
}

export function createRdapServer(options: RdapOptions): Server {
  return createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const reply =
      req.method === "GET"
        ? rdapReply(path, options)
        : { status: 405, body: rdapError(405, "Method Not Allowed", "only GET") };
    res.writeHead(reply.status, {
      "content-type": path === "/health" ? "application/json" : RDAP_JSON,
    });
    res.end(JSON.stringify(reply.body));
  });
}

if (import.meta.main) {
  const log = (line: Record<string, unknown>) =>
    console.log(JSON.stringify({ time: new Date().toISOString(), ...line }));
  const port = Number(process.env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 0) {
    log({ level: "fatal", event: "rdap.config", reason: "PORT must be a whole number" });
    process.exit(1);
  }
  const server = createRdapServer({ domains: readDomains(), log });
  server.listen(port, "0.0.0.0", () =>
    log({ level: "info", event: "rdap.ready", port: (server.address() as AddressInfo).port }),
  );
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log({ level: "info", event: "rdap.stopping", signal });
      server.close(() => process.exit(0));
      server.closeAllConnections();
    });
  }
}
