import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [react()],
  // test-setup.ts gives every test's findBy* and waitFor room on a loaded machine.
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
});
