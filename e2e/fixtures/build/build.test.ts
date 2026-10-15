import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixturesDir } from "../format.ts";
import { buildFixtures, composeText, generatedFilesOnDisk } from "./build.ts";
import { maria } from "./maria.ts";
import { tom } from "./tom.ts";

// The committed fixtures are the generator's output, byte for byte: edit the sources and run
// `node e2e/fixtures/build/main.ts`, never the generated files.

describe("the fixture generator", () => {
  const root = fixturesDir();
  const files = buildFixtures();

  it("reproduces every committed fixture file byte for byte", () => {
    const mismatched = [...files].filter(
      ([path, content]) => readFileSync(join(root, path), "utf8") !== content,
    );
    expect(mismatched.map(([path]) => path)).toEqual([]);
  });

  it("leaves no file in the generated directories that it doesn't write", () => {
    expect(generatedFilesOnDisk(root).sort()).toEqual([...files.keys()].sort());
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
