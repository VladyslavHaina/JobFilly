import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MVP 2 (F6.6) sent nothing; from MVP 3 (F4, D9 of its plan) nothing is sent without a confirmed
// send. This guard is narrowed to that, not dropped: apps/server never imports nodemailer,
// creates a transport or opens a socket of its own (SMTP lives in packages/mail/src/smtp, which
// guards its own sources); the SMTP port's send is called by the mail.send job alone; and only
// confirming a draft with its token (send/confirm.ts) enqueues that job. send/send.test.ts shows
// at run time that a send without a token, with a stale one, or undone, sends nothing.

const SRC = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

const files = sourceFiles(SRC);
const read = (file: string) => readFileSync(file, "utf8");
const named = (test: (text: string) => boolean) =>
  files.filter((f) => test(read(f))).map((f) => relative(SRC, f));

describe("nothing is sent without a confirmed send (F4, narrowing MVP 2's F6.6)", () => {
  it("reads the sources it guards", () => {
    const names = files.map((f) => relative(SRC, f));
    expect(names).toContain(join("sync", "run.ts"));
    expect(names).toContain(join("send", "jobs.ts"));
    expect(names).toContain("deps.ts");
  });

  it("never imports nodemailer or creates a transport", () => {
    const offending: string[] = [];
    for (const file of files) {
      const text = read(file);
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

  it("sends through the SMTP port only from the mail.send job", () => {
    expect(named((t) => /\bsmtp\.send\(/.test(t))).toEqual([join("send", "jobs.ts")]);
    // packages/mail's sendSmtp itself is named only where deps.ts wires the port.
    expect(named((t) => /\bsendSmtp\b/.test(t))).toEqual(["deps.ts"]);
  });

  it("enqueues mail.send only when a draft is confirmed with its token", () => {
    expect(named((t) => /\bMAIL_SEND_JOB\b/.test(t)).sort()).toEqual([
      join("send", "confirm.ts"),
      join("send", "jobs.ts"),
    ]);
    const confirm = read(join(SRC, "send", "confirm.ts"));
    const job = confirm.indexOf("type: MAIL_SEND_JOB");
    // The token is checked before the job is enqueued.
    expect(confirm.indexOf("checkSendToken(")).toBeGreaterThan(-1);
    expect(confirm.indexOf("checkSendToken(")).toBeLessThan(job);
  });
});
