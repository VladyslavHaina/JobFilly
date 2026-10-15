import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./index";

describe("openDatabase", () => {
  it("opens an in-memory database and runs a query", async () => {
    const db = openDatabase(":memory:");
    try {
      expect(await db.all(sql`select 1 as one`)).toEqual([{ one: 1 }]);
    } finally {
      db.$client.close();
    }
  });
});
