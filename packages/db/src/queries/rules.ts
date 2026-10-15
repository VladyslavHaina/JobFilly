import type { Rule } from "@jobfilly/schema";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "../client";
import { rules } from "../tables";

// The rules of a profile (F3), read. Every write goes through applyProfileChanges
// (./profile-changes.ts), so each one is recorded in the profile history.

type RuleRow = typeof rules.$inferSelect;

export function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    profileId: row.profileId,
    description: row.description,
    when: row.conditions,
    then: row.action,
    enabled: row.enabled,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

/** A profile's rules, oldest first. */
export async function listRules(
  db: Database,
  workspaceId: string,
  profileId: string,
): Promise<Rule[]> {
  const rows = await db
    .select()
    .from(rules)
    .where(and(eq(rules.workspaceId, workspaceId), eq(rules.profileId, profileId)))
    .orderBy(asc(rules.createdAt), asc(rules.id));
  return rows.map(toRule);
}

/** One rule of the workspace, or null. */
export async function getRule(
  db: Database,
  workspaceId: string,
  ruleId: string,
): Promise<Rule | null> {
  const [row] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.workspaceId, workspaceId), eq(rules.id, ruleId)));
  return row ? toRule(row) : null;
}
