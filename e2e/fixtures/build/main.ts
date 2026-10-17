import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fixturesDir } from "../format.ts";
import {
  buildStackData,
  type FileContent,
  generatedFilesOnDisk,
  STACK_DATA_DIRS,
} from "./build.ts";
import { buildAllFixtures, generatedFixturesOnDisk } from "./mvp3-files.ts";

// Regenerates every fixture file from the personas' sources of truth:
//   node e2e/fixtures/build/main.ts
// Files in the generated directories that the sources no longer produce are deleted, so the
// committed fixtures are exactly what buildAllFixtures (buildFixtures and MVP 3's files) and
// buildStackData return (build.test.ts checks it).

function write(root: string, files: Map<string, FileContent>, owned: string[]) {
  for (const path of owned) if (!files.has(path)) rmSync(join(root, path));
  for (const [path, content] of files) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

const root = fixturesDir();
const fixtures = buildAllFixtures();
write(root, fixtures, generatedFixturesOnDisk(root));
const e2e = resolve(root, "..");
const stack = buildStackData();
write(e2e, stack, generatedFilesOnDisk(e2e, STACK_DATA_DIRS));
console.log(`wrote ${fixtures.size} fixture files to ${root} and ${stack.size} to ${e2e}`);
