import type { User } from "@jobfilly/schema";
import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { memberships, users, workspaces } from "../tables";

// User accounts. Users aren't workspace data: they are found by id or by email.

export interface StoredUser extends User {
  passwordHash: string;
}

export type RegisterResult =
  | { ok: true; user: User; workspaceId: string }
  | { ok: false; reason: "email_taken" };

/**
 * Creates the user and their personal workspace, with the user as owner and admin, in one
 * transaction. `email` must already be lower case.
 */
export async function registerAccount(
  db: Database,
  input: { name: string; email: string; passwordHash: string; workspaceName: string },
): Promise<RegisterResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email, passwordHash: input.passwordHash })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, name: users.name, email: users.email });
    if (!user) return { ok: false as const, reason: "email_taken" as const };
    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: input.workspaceName, ownerId: user.id })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("workspace insert returned nothing");
    await tx
      .insert(memberships)
      .values({ workspaceId: workspace.id, userId: user.id, role: "admin" });
    return { ok: true as const, user, workspaceId: workspace.id };
  });
}

export async function findUserByEmail(db: Database, email: string): Promise<StoredUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()));
  return row ?? null;
}
