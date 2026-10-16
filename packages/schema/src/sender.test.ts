import { describe, expect, it } from "vitest";
import { AppliedMarkSchema, AppliedSenderMarkSchema, SenderMarkInputSchema } from "./sender";

// PUT /senders/marks is validated by its schema alone: the server's validJson answers 400 with the
// first issue's message, and the web client parses with the same schema.

const issue = (input: unknown) => {
  const result = SenderMarkInputSchema.safeParse(input);
  return result.success ? null : result.error.issues.map((i) => [i.path, i.message]);
};

describe("SenderMarkInputSchema", () => {
  it("keeps an address or a domain trimmed and lower case", () => {
    expect(
      SenderMarkInputSchema.parse({ scope: "address", value: " Ann@X.Example ", mark: "trusted" }),
    ).toEqual({ scope: "address", value: "ann@x.example", mark: "trusted" });
    expect(
      SenderMarkInputSchema.parse({ scope: "domain", value: "Tidewater.Example", mark: null }),
    ).toEqual({ scope: "domain", value: "tidewater.example", mark: null });
  });

  it("takes an address's domain after its last '@'", () => {
    expect(issue({ scope: "address", value: '"a@b"@x.example', mark: "blocked" })).toBeNull();
  });

  it("refuses an address without an '@' or without a dotted domain", () => {
    const words = [[["value"], "Give an email address"]];
    expect(issue({ scope: "address", value: "nobody", mark: "blocked" })).toEqual(words);
    expect(issue({ scope: "address", value: "nobody@localhost", mark: "blocked" })).toEqual(words);
    expect(issue({ scope: "address", value: "@x.example", mark: "blocked" })).toEqual(words);
    expect(issue({ scope: "address", value: "ann@", mark: null })).toEqual(words);
  });

  it("refuses a domain given as an address, or without a dot", () => {
    const words = [[["value"], "Give a domain such as example.com"]];
    expect(issue({ scope: "domain", value: "a@b.example", mark: "blocked" })).toEqual(words);
    expect(issue({ scope: "domain", value: "localhost", mark: "trusted" })).toEqual(words);
  });

  it("refuses an empty, too long or unknown scope or mark", () => {
    expect(SenderMarkInputSchema.safeParse({}).success).toBe(false);
    expect(
      SenderMarkInputSchema.safeParse({ scope: "domain", value: "  ", mark: null }).success,
    ).toBe(false);
    const long = `${"a".repeat(311)}@x.example`;
    expect(
      SenderMarkInputSchema.safeParse({ scope: "address", value: long, mark: null }).success,
    ).toBe(false);
    expect(
      SenderMarkInputSchema.safeParse({ scope: "company", value: "x.example", mark: null }).success,
    ).toBe(false);
    expect(
      SenderMarkInputSchema.safeParse({ scope: "domain", value: "x.example", mark: "maybe" })
        .success,
    ).toBe(false);
  });
});

describe("AppliedMarkSchema", () => {
  it("is the mark the applied-mark answer carries", () => {
    const mark = { scope: "domain", value: "x.example", mark: "blocked" } as const;
    expect(AppliedMarkSchema.parse(mark)).toEqual(mark);
    expect(AppliedSenderMarkSchema.parse({ applied: mark })).toEqual({ applied: mark });
    expect(AppliedSenderMarkSchema.parse({ applied: null })).toEqual({ applied: null });
    expect(AppliedMarkSchema.safeParse({ ...mark, mark: null }).success).toBe(false);
  });
});
