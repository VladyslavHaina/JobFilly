import { chooseCv } from "@jobfilly/core";
import { getRoleCvChoice, listCvs, listCvsForProfile } from "@jobfilly/db";
import type { CvChoiceStage } from "./stages";

// The cv-choice stage (F2.3): the CV the app would use for a role, with its reason, or the one an
// editor chose for it. It reads the profile's CVs, the role's facts and the message's language as
// the sender stage stored it, never the mailbox, so re-scoring after a change stays mailbox-free.
// The match stage gets the chosen CV's skills (F4.4).

export const cvChoiceStage: CvChoiceStage = async ({ message, role }, ctx) => {
  const { db } = ctx.deps;
  const cvs = ctx.profile
    ? await listCvsForProfile(db, ctx.ws, ctx.profile.id)
    : await listCvs(db, ctx.ws);
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
