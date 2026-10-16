import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Nothing is sent in MVP 2 (F6.6): no code in apps/server can make an SMTP connection. The
// server never imports nodemailer, creates a transport or names SMTP; it reaches the mailbox only
// through packages/mail's MailClient, which guards its own sources the same way
// (packages/mail/src/no-smtp.test.ts).

const SRC = fileURLToPath(new URL("../", import.meta.url));

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
    expect(names).toContain(join("sync", "run.ts"));
    expect(names).toContain("deps.ts");
  });

  it("never imports nodemailer or creates a transport", () => {
    const offending: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/from\s+["']nodemailer[^"']*["']/.test(text)) offending.push(`${file}: nodemailer`);
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
