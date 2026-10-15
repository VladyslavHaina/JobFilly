import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

// Opens the app database. `url` is a libSQL URL: `file:/path/to/jobfilly.db`
// on disk, or `:memory:` in tests.
export function openDatabase(url: string) {
  return drizzle({ client: createClient({ url }) });
}

export type Database = ReturnType<typeof openDatabase>;
