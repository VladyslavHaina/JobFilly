import { activityRows } from "@jobfilly/db/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, draftAnswer, type Harness } from "../testing/replies";

// The activity log (MVP 3, F9.1) records every draft saved to the mailbox: the app's own, by id
// only (no name, address or text).

const BERLIN = "<berlin@talentbruecke.example>";

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.close());

describe("a draft saved to the mailbox (F9.1)", () => {
  it("is in the activity log as the app's own action, by id", async () => {
    await h.deliver(BERLIN);
    h.ai.answers.draft[`${BERLIN}#0#1`] = draftAnswer();
    await h.evaluate(BERLIN);
    await h.drain();
    const draft = await h.live(BERLIN);
    expect(draft?.status).toBe("in_mailbox");
    expect(await activityRows(h.deps.db, h.ws)).toEqual([
      {
        kind: "draft.saved",
        actorKind: "system",
        actorId: null,
        targetUserId: null,
        refs: { draftId: draft?.id, messageId: BERLIN, position: 0 },
      },
    ]);
  });
});
