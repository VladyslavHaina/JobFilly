import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixturesDir } from "../format.ts";
import {
  buildFixtures,
  buildStackData,
  composeText,
  type FileContent,
  generatedFilesOnDisk,
  STACK_DATA_DIRS,
} from "./build.ts";
import { maria } from "./maria.ts";
import { buildAllFixtures, generatedFixturesOnDisk } from "./mvp3-files.ts";
import { tom } from "./tom.ts";

// The committed fixtures are the generator's output, byte for byte: edit the sources and run
// `node e2e/fixtures/build/main.ts`, never the generated files.

const mismatched = (root: string, files: Map<string, FileContent>) =>
  [...files]
    .filter(([path, content]) => !readFileSync(join(root, path)).equals(Buffer.from(content)))
    .map(([path]) => path);

describe("the fixture generator", () => {
  const root = fixturesDir();
  const files = buildAllFixtures();
  const e2e = resolve(root, "..");
  const stack = buildStackData();

  it("reproduces every committed fixture file byte for byte", () => {
    expect(mismatched(root, files)).toEqual([]);
  });

  it("reproduces the committed RDAP data and DNS zones byte for byte", () => {
    expect(mismatched(e2e, stack)).toEqual([]);
  });

  it("leaves no file in the generated directories that it doesn't write", () => {
    expect(generatedFixturesOnDisk(root).sort()).toEqual([...files.keys()].sort());
    expect(generatedFilesOnDisk(e2e, STACK_DATA_DIRS).sort()).toEqual(
      [...stack.keys()].filter((p) => p.startsWith("dns/zones/")).sort(),
    );
  });

  it("only adds to what MVP 1 and MVP 2 write: every file, and every key of its JSON, kept", () => {
    const changed: string[] = [];
    for (const [path, before] of buildFixtures()) {
      const after = files.get(path);
      if (after === undefined) {
        changed.push(`${path}: gone`);
      } else if (!Buffer.from(after).equals(Buffer.from(before))) {
        // Only a JSON map may change, and only by gaining keys.
        const was = JSON.parse(String(before)) as Record<string, unknown>;
        const now = JSON.parse(String(after)) as Record<string, unknown>;
        for (const [key, value] of Object.entries(was)) {
          if (JSON.stringify(now[key]) !== JSON.stringify(value)) changed.push(`${path}: ${key}`);
        }
      }
    }
    expect(changed).toEqual([]);
  });

  it("writes the CVs as bytes and everything else as text", () => {
    const binary = [...files].filter(([, c]) => Buffer.isBuffer(c)).map(([p]) => p);
    expect(binary.sort()).toEqual([
      "maria/cvs/backend-de.docx",
      "maria/cvs/backend-en.pdf",
      "maria/cvs/data-engineering-en.pdf",
      "tom/cvs/nurse-en.docx",
    ]);
  });

  it("pads a short body with footer paragraphs before the sentinel", () => {
    const spec = { ...maria().messages[0], body: "Hi", footer: ["x".repeat(600)] };
    const text = composeText(spec as Parameters<typeof composeText>[0], "BODYSENTINEL-x");
    expect(text.indexOf("BODYSENTINEL-x")).toBeGreaterThanOrEqual(1000);
    expect(text.startsWith("Hi\n\nxxx")).toBe(true);
  });

  it("names each message <persona-nnnn@sender-domain> in source order", () => {
    const [first] = tom().messages;
    expect(first?.messageId).toBe("<tom-0001@jobs.nhs.uk>");
  });
});
