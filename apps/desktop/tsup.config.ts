import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  // Bundle everything except Electron itself: pnpm keeps each package's
  // dependencies private, so the output cannot rely on finding the server's
  // dependencies at runtime. Native modules are the exception: add them to
  // `external` and to this app's own dependencies.
  external: ["electron"],
  noExternal: [/^(?!electron$).*/],
  clean: true,
});
