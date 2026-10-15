import { describe, expect, it } from "vitest";
import { newDraftMessageId } from "./message-id";

describe("newDraftMessageId", () => {
  it("is a new <uuid@domain> on the mailbox address's domain each time", () => {
    const first = newDraftMessageId("maria.santos@inbox.example");
    expect(first).toMatch(/^<[0-9a-f-]{36}@inbox\.example>$/);
    expect(newDraftMessageId("maria.santos@inbox.example")).not.toBe(first);
  });

  it("falls back to a domain no one has when the address has none", () => {
    for (const address of ["", "maria", "maria@localhost", "a b@x.example"]) {
      expect(newDraftMessageId(address)).toMatch(/^<[0-9a-f-]{36}@jobfilly\.invalid>$/);
    }
  });
});
