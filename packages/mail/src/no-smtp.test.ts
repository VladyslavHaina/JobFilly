import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MVP 2 (F6.6) sent nothing; from MVP 3 (F4, D9 of its plan) nothing is sent without a confirmed
// send. This guard is narrowed to that: SMTP lives in ./smtp alone. Everywhere else in this
// package nodemailer is used only for its MailComposer (drafts/index.ts), which composes a
// message and never opens a socket, and no source creates a transport or opens a socket of its
// own. drafts.test.ts shows the same at run time for drafts, with spies on createTransport and
// the socket functions; apps/server guards that only its send job calls the SMTP port.

const SRC = fileURLToPath(new URL("./", import.meta.url));
const SMTP_DIR = `smtp${sep}`;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

const TRANSPORT =
  /createTransport|smtp-(transport|connection|pool)|\bnet\.connect\b|\btls\.connect\b/;

describe("SMTP only in ./smtp (F4, narrowing MVP 2's F6.6)", () => {
  const files = sourceFiles(SRC);
  const outside = files.filter((f) => !relative(SRC, f).startsWith(SMTP_DIR));
  const inside = files.filter((f) => relative(SRC, f).startsWith(SMTP_DIR));

  it("reads the sources it guards", () => {
    const names = files.map((f) => relative(SRC, f));
    expect(names).toContain(join("drafts", "index.ts"));
    expect(names).toContain("client.ts");
    expect(names).toContain(join("smtp", "index.ts"));
  });

  it("outside ./smtp, imports nodemailer only for its MailComposer and never creates a transport", () => {
    const offending: string[] = [];
    for (const file of outside) {
      const text = readFileSync(file, "utf8");
      const imports = [...text.matchAll(/from\s+["'](nodemailer[^"']*)["']/g)].map((m) => m[1]);
      for (const name of imports) {
        if (name !== "nodemailer/lib/mail-composer") offending.push(`${file}: ${name}`);
      }
      if (TRANSPORT.test(text)) offending.push(`${file}: transport or socket`);
    }
    expect(offending).toEqual([]);
  });

  it("creates the SMTP transport in ./smtp/index.ts alone, and opens no socket of its own", () => {
    const creating = inside.filter((f) => /createTransport\(/.test(readFileSync(f, "utf8")));
    expect(creating.map((f) => relative(SRC, f))).toEqual([join("smtp", "index.ts")]);
    for (const file of inside) {
      expect(readFileSync(file, "utf8")).not.toMatch(/\bnet\.connect\b|\btls\.connect\b/);
    }
  });
});
