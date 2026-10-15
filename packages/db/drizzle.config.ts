import { defineConfig } from "drizzle-kit";

// `pnpm --filter @jobfilly/db exec drizzle-kit generate` writes a migration from src/tables.ts.
// Hand edits to a generated file (such as CREATE EXTENSION) stay in that file.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/tables.ts",
  out: "./migrations",
});
