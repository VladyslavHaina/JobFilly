import { chooseCv } from "@jobfilly/core";
import { getRoleCvChoice, listCvsForProfile } from "@jobfilly/db";
import type { CvChoiceStage } from "./stages";

// The cv-choice stage (F2.3): the CV the app would use for a role, with its reason, or the one an
// editor chose for it. It reads the profile's CVs, the role's facts and the message's language as
// the sender stage stored it, never the mailbox, so re-scoring after a change stays mailbox-free.
// The match stage gets the chosen CV's skills (F4.4). Roles are scored only once a profile is
// confirmed (pipeline/evaluate), so a stage call without one is a caller's mistake, not a choice
// among all of the workspace's CVs.

export const cvChoiceStage: CvChoiceStage = async ({ message, role }, ctx) => {
  const { db } = ctx.deps;
  if (!ctx.profile) throw new Error("the cv-choice stage needs a confirmed profile");
  const cvs = await listCvsForProfile(db, ctx.ws, ctx.profile.id);
  const override = await getRoleCvChoice(db, ctx.ws, {
    messageId: message.messageId,
    position: role.position,
  });
  const choice = chooseCv({ role: role.facts, language: message.language, cvs, override });
  return {
    cvId: choice.cv?.id ?? null,
    name: choice.cv?.name ?? null,
    language: choice.cv?.language ?? null,
    skills: choice.cv ? [...choice.cv.skills] : [],
    reason: choice.reason,
    source: choice.source,
  };
};
