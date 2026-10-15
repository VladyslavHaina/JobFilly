import { describe, expect, it } from "vitest";
import { LiveAccessChangeSchema, LiveNotificationSchema } from "./events";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";

describe("live access changes", () => {
  it("accepts a removed member and an ended session", () => {
    const removed = { type: "member.removed", workspaceId, userId };
    expect(LiveAccessChangeSchema.parse(removed)).toEqual(removed);
    const ended = { type: "session.ended", sessionId };
    expect(LiveAccessChangeSchema.parse(ended)).toEqual(ended);
  });

  it("refuses an unknown type, a missing id or an id that isn't a UUID", () => {
    const bad = [
      { type: "member.added", workspaceId, userId },
      { type: "member.removed", workspaceId },
      { type: "member.removed", userId },
      { type: "member.removed", workspaceId: "w1", userId },
      { type: "session.ended" },
      { type: "session.ended", sessionId: "a-cookie-token" },
    ];
    for (const value of bad) expect(LiveAccessChangeSchema.safeParse(value).success).toBe(false);
  });
});

describe("live channel notifications", () => {
  it("is either an event for a workspace or an access change", () => {
    const envelope = { workspaceId, event: { type: "workspace.updated", data: {} } };
    expect(LiveNotificationSchema.parse(envelope)).toEqual(envelope);
    const change = { type: "member.removed", workspaceId, userId };
    expect(LiveNotificationSchema.parse(change)).toEqual(change);
  });

  it("refuses an event without its workspace and anything else", () => {
    expect(LiveNotificationSchema.safeParse({ type: "workspace.updated", data: {} }).success).toBe(
      false,
    );
    expect(LiveNotificationSchema.safeParse({ workspaceId }).success).toBe(false);
    expect(LiveNotificationSchema.safeParse({ type: "session.ended" }).success).toBe(false);
  });
});
