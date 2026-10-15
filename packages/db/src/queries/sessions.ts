import type { User } from "@jobfilly/schema";
import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { sessions, users } from "../tables";

// Sessions are looked up by the SHA-256 hash of the cookie value; the value is never stored.
// Expiry (idle and absolute) is decided by the server's clock, not here.

export interface StoredSession {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  user: User;
}

export async function createSession(
  db: Database,
  input: { userId: string; tokenHash: string; now: Date },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      createdAt: input.now,
      lastUsedAt: input.now,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error("session insert returned nothing");
  return row;
}

export async function findSession(db: Database, tokenHash: string): Promise<StoredSession | null> {
  const [row] = await db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      userId: users.id,
      name: users.name,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash));
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    user: { id: row.userId, name: row.name, email: row.email },
  };
}

export async function touchSession(db: Database, sessionId: string, now: Date): Promise<void> {
  await db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, sessionId));
}

export async function deleteSession(db: Database, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
