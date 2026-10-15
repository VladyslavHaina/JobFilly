import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixturesDir } from "../format.ts";
import { buildFixtures, generatedFilesOnDisk } from "./build.ts";

// Regenerates every fixture file from the personas' sources of truth:
//   node e2e/fixtures/build/main.ts
// Files in the generated directories that the sources no longer produce are deleted, so the
// committed fixtures are exactly what buildFixtures returns (build.test.ts checks it).

const root = fixturesDir();
const files = buildFixtures();
for (const path of generatedFilesOnDisk(root)) {
  if (!files.has(path)) rmSync(join(root, path));
}
for (const [path, content] of files) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
console.log(`wrote ${files.size} fixture files to ${root}`);
