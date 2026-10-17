import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type DeliveryEntry,
  type EnvelopeEntry,
  fixturesDir,
  PERSONAS,
  personaPaths,
  personaPathsMvp2,
  readJson,
} from "../fixtures/format.ts";
import { findDomain, readDomains } from "../rdap/domains.ts";

// The zone check: every sender domain in the fixtures (both mailboxes and the delivered mail)
// has an MX record in CoreDNS (the .example zone, or the Corefile's exact-name templates for
// public domains) whose mail host resolves, and a registration in the fake RDAP service's data,
// so the sender check never falls back to the internet or ends incomplete. Every other name under
// a public domain (imap.gmail.com, smtp.gmail.com) falls through to the upstream resolver.

const DNS = import.meta.dirname;
const fixtures = fixturesDir();

/** The From domain of every fixture message, from envelopes.json and the delivered .eml files. */
function senderDomains(): Set<string> {
  const out = new Set<string>();
  const domainOf = (address: string) => address.slice(address.indexOf("@") + 1).toLowerCase();
  for (const persona of PERSONAS) {
    for (const e of readJson<EnvelopeEntry[]>(join(fixtures, personaPaths(persona).envelopes))) {
      out.add(domainOf(e.from.address));
    }
    const paths = personaPathsMvp2(persona);
    for (const d of readJson<DeliveryEntry[]>(join(fixtures, paths.deliveries))) {
      const eml = readFileSync(join(fixtures, paths.deliver, d.file), "utf8");
      const from = /^From: .*<([^>]+)>\r?$/m.exec(eml)?.[1];
      expect(from, d.file).toBeDefined();
      out.add(domainOf(from as string));
    }
  }
  return out;
}

interface ZoneRecord {
  name: string;
  type: string;
  data: string;
}

/** The records of one zone file, names fully qualified without the final dot. */
function parseZone(text: string): { origin: string; records: ZoneRecord[] } {
  let origin = "";
  const records: ZoneRecord[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/;.*$/, "").trim();
    if (line === "") continue;
    if (line.startsWith("$ORIGIN ")) {
      origin = line.slice("$ORIGIN ".length).replace(/\.$/, "");
      continue;
    }
    if (line.startsWith("$")) continue;
    const [owner, klass, type, ...data] = line.split(/\s+/);
    expect(klass, line).toBe("IN");
    const name = owner === "@" ? origin : `${owner}.${origin}`;
    records.push({ name, type: type as string, data: data.join(" ") });
  }
  return { origin, records };
}

interface Template {
  type: string;
  matches: RegExp[];
  answer: string;
  fallthrough: boolean;
}

/** The Corefile's template blocks: the names they answer, the answer and whether they fall through. */
function parseTemplates(text: string): Template[] {
  const out: Template[] = [];
  for (const block of text.matchAll(/^\s*template IN (\w+) \{\n([\s\S]*?)^\s*\}$/gm)) {
    const body = block[2] as string;
    out.push({
      type: block[1] as string,
      matches: [...body.matchAll(/^\s*match "([^"]+)"$/gm)].map((m) => new RegExp(m[1] as string)),
      answer: /^\s*answer "([^"]+)"$/m.exec(body)?.[1] ?? "",
      fallthrough: /^\s*fallthrough$/m.test(body),
    });
  }
  return out;
}

/** The records a template answers: one per exact name its regexes match, as CoreDNS renders it. */
function templateRecords(t: Template): ZoneRecord[] {
  return t.matches.map((re) => {
    const name = re.source
      .replace(/^\^/, "")
      .replace(/\[\.\]\$$/, "")
      .replaceAll("[.]", ".");
    const [, , , type, ...data] = t.answer.replaceAll("{{ .Name }}", `${name}.`).split(" ");
    return { name, type: type as string, data: data.join(" ") };
  });
}

const zonesDir = join(DNS, "zones");
const zones = readdirSync(zonesDir)
  .sort()
  .map((file) => ({ file, ...parseZone(readFileSync(join(zonesDir, file), "utf8")) }));
const corefileText = readFileSync(join(DNS, "Corefile"), "utf8");
const templates = parseTemplates(corefileText);
const records = [...zones.flatMap((z) => z.records), ...templates.flatMap(templateRecords)];
const domains = senderDomains();

/** Whether the stack's CoreDNS answers `name` itself (a zone or a template), not the upstream. */
function answeredLocally(name: string, type: string): boolean {
  const inZone = zones.some((z) => name === z.origin || name.endsWith(`.${z.origin}`));
  const templated = templates.some(
    (t) => t.type === type && t.matches.some((re) => re.test(`${name}.`)),
  );
  return inZone || templated;
}

describe("the CoreDNS zone", () => {
  it("names each zone file db.<origin>, with an SOA and an NS record whose server resolves", () => {
    for (const z of zones) {
      expect(z.file).toBe(`db.${z.origin}`);
      expect(z.records.filter((r) => r.name === z.origin && r.type === "SOA")).toHaveLength(1);
      const ns = z.records.find((r) => r.name === z.origin && r.type === "NS");
      expect(ns, z.file).toBeDefined();
      const host = ns?.data.replace(/\.$/, "");
      expect(z.records.some((r) => r.name === host && r.type === "A")).toBe(true);
    }
  });

  it("gives every sender domain an MX record whose mail host has an address", () => {
    for (const domain of domains) {
      const mx = records.filter((r) => r.name === domain && r.type === "MX");
      expect(mx, domain).toHaveLength(1);
      const [preference, host] = (mx[0]?.data ?? "").split(" ");
      expect(Number(preference)).toBeGreaterThan(0);
      expect(host?.endsWith("."), domain).toBe(true);
      const hostName = (host ?? "").replace(/\.$/, "");
      expect(
        records.some((r) => r.name === hostName && r.type === "A" && r.data.startsWith("192.0.2.")),
        hostName,
      ).toBe(true);
    }
  });

  it("serves each domain from the zone it belongs to, and no MX for a name that sends nothing", () => {
    for (const r of records.filter((x) => x.type === "MX")) {
      expect(domains.has(r.name), r.name).toBe(true);
    }
    for (const z of zones) {
      for (const r of z.records)
        expect(r.name === z.origin || r.name.endsWith(`.${z.origin}`)).toBe(true);
    }
  });

  it("covers the free-mail and job-platform domains as well as the .example ones", () => {
    expect(domains.has("gmail.com")).toBe(true);
    expect(domains.has("linkedin.com")).toBe(true);
    expect(zones.map((z) => z.origin)).toContain("example");
  });

  it("owns only the reserved .example zone, never a public mail provider's whole domain", () => {
    // A zone for gmail.com made imap.gmail.com and smtp.gmail.com NXDOMAIN inside the stack.
    expect(zones.map((z) => z.origin)).toEqual(["example"]);
    for (const domain of domains) {
      if (domain.endsWith(".example")) continue;
      expect(answeredLocally(domain, "MX"), domain).toBe(true);
      for (const host of ["imap", "smtp", "www", "mail"]) {
        for (const type of ["A", "AAAA", "MX"]) {
          expect(answeredLocally(`${host}.${domain}`, type), `${type} ${host}.${domain}`).toBe(
            false,
          );
        }
      }
      expect(answeredLocally(domain, "A"), `A ${domain}`).toBe(false);
    }
    expect(answeredLocally("imap.gmail.com", "A")).toBe(false);
    expect(answeredLocally("smtp.gmail.com", "A")).toBe(false);
    expect(answeredLocally("oauth2.googleapis.com", "A")).toBe(false);
  });

  it("answers public names by exact match and lets every other name fall through", () => {
    expect(templates.map((t) => t.type).sort()).toEqual(["A", "MX"]);
    for (const t of templates) {
      expect(t.fallthrough, t.type).toBe(true);
      for (const re of t.matches) expect(re.source).toMatch(/^\^.*\[\.\]\$$/);
    }
  });
});

describe("the fake RDAP data", () => {
  const file = readDomains();

  it("registers every sender domain, and nothing else", () => {
    for (const domain of domains) expect(findDomain(file, domain), domain).not.toBeNull();
    expect(Object.keys(file.domains).sort()).toEqual([...domains].sort());
  });

  it("makes only the two scams' domains young", () => {
    const young = Object.entries(file.domains)
      .filter(([, e]) => e.registeredDaysAgo < 365)
      .map(([d]) => d);
    expect(young.sort()).toEqual(["globalcareers-mail.example", "quickhire-global.example"]);
  });
});

describe("the Corefile", () => {
  const corefile = corefileText;

  it("loads every zone file from /zones and forwards every other name", () => {
    expect(corefile).toMatch(/auto \{\s+directory \/zones\s+\}/);
    expect(corefile).toMatch(/^\s+forward \. \/etc\/resolv\.conf$/m);
  });
});
