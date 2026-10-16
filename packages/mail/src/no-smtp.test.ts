import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Nothing is sent in MVP 2 (F6.6): no code in this package can make an SMTP connection.
// nodemailer is used only for its MailComposer (drafts/index.ts), which composes a message and
// never opens a socket; no source here creates a transport or names SMTP. drafts.test.ts shows
// the same at run time with spies on createTransport and the socket functions; apps/server
// guards its own sources the same way.

const SRC = fileURLToPath(new URL("./", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("no SMTP (F6.6)", () => {
  const files = sourceFiles(SRC);

  it("reads the sources it guards", () => {
    const names = files.map((f) => relative(SRC, f));
    expect(names).toContain(join("drafts", "index.ts"));
    expect(names).toContain("client.ts");
  });

  it("imports nodemailer only for its MailComposer, and never creates a transport", () => {
    const offending: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const imports = [...text.matchAll(/from\s+["'](nodemailer[^"']*)["']/g)].map((m) => m[1]);
      for (const name of imports) {
        if (name !== "nodemailer/lib/mail-composer") offending.push(`${file}: ${name}`);
      }
      if (
        /createTransport|smtp-(transport|connection|pool)|\bnet\.connect\b|\btls\.connect\b/.test(
          text,
        )
      ) {
        offending.push(`${file}: transport or socket`);
      }
    }
    expect(offending).toEqual([]);
  });
});
