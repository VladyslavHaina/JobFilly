import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { roleProfileChoices } from "../tables";
import type { RoleRef } from "./evaluations";

// Which profile each role belongs to (MVP 3, F1.3): an editor's choice (role_profile_choices).
// No row means the automatic assignment (packages/core assignProfile); the pipeline stores the
// outcome on the role's evaluation (role_evaluations.profile_id, reason and source).

/** The editors' profile choices for the roles of a message, by position. */
export async function getRoleProfileChoices(
  db: Database,
  workspaceId: string,
  messageId: string,
): Promise<Map<number, string>> {
  const rows = await db
    .select({ position: roleProfileChoices.position, profileId: roleProfileChoices.profileId })
    .from(roleProfileChoices)
    .where(
      and(
        eq(roleProfileChoices.workspaceId, workspaceId),
        eq(roleProfileChoices.messageId, messageId),
      ),
    );
  return new Map(rows.map((r) => [r.position, r.profileId]));
}

/** An editor puts a role in a profile by hand; it stays there until changed again. */
export async function setRoleProfileChoice(
  db: Database,
  workspaceId: string,
  role: RoleRef,
  input: { profileId: string; userId: string; at: Date },
): Promise<void> {
  const set = { profileId: input.profileId, chosenBy: input.userId, chosenAt: input.at };
  await db
    .insert(roleProfileChoices)
    .values({ workspaceId, messageId: role.messageId, position: role.position, ...set })
    .onConflictDoUpdate({
      target: [
        roleProfileChoices.workspaceId,
        roleProfileChoices.messageId,
        roleProfileChoices.position,
      ],
      set,
    });
}
