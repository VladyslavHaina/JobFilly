import { describe, expect, it } from "vitest";
import { nextPath } from "./next";

const search = (next: string) => `?${new URLSearchParams({ next })}`;

describe("nextPath", () => {
  it("keeps an in-app path with its query and hash", () => {
    expect(nextPath(search("/invites/abc?token=t#top"))).toBe("/invites/abc?token=t#top");
  });

  it("refuses anything that leaves the app, as the browser reads it", () => {
    for (const next of [
      "//evil.example",
      "/\\evil.example",
      "/.//evil.example",
      "/..//evil.example",
      "/\t/evil.example",
      "https://evil.example",
      "evil",
    ]) {
      expect(nextPath(search(next))).toBeNull();
    }
    expect(nextPath("")).toBeNull();
  });
});
