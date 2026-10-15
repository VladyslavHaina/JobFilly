import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  // Bundle everything: pnpm keeps each package's dependencies private, so the
  // output cannot rely on finding a workspace package's dependencies at
  // runtime. Native modules are the exception: list them in `external` and
  // add them to this app's own dependencies.
  noExternal: [/.*/],
  // pg's optional native binding is never used (pg.native is never read).
  external: ["pg-native"],
  // Bundled CommonJS (pg) calls require() for Node built-ins; give the ESM bundle one.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  clean: true,
});
