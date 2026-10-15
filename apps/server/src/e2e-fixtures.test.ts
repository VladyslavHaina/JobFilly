import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AiTestOutputSchema,
  CategorySchema,
  ClassifyOutputSchema,
  CORE_PROFILE_KEYS,
  EnvelopeSchema,
  ExtractOutputSchema,
  ExtraSlugSchema,
  IntakeExtraOutputSchema,
  JobFactsSchema,
  MailFolderSchema,
  PROFILE_VALUE_SCHEMAS,
  PrefsOutputSchema,
  StageOneVerdictSchema,
} from "@jobfilly/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// The test stack's fixtures (e2e/fixtures) against the real schemas: every fake-AI answer must be
// what packages/ai accepts, and the ground truth must be what the app can store and show. The
// files are read from disk; e2e code is never imported (ARCHITECTURE › Packages).

const FIXTURES = fileURLToPath(new URL("../../../e2e/fixtures/", import.meta.url));
const read = (path: string): unknown => JSON.parse(readFileSync(`${FIXTURES}${path}`, "utf8"));
const PERSONAS = ["maria", "tom"] as const;

const Invalid = z.strictObject({ invalid: z.literal(true) });
const answerFile = <T extends z.ZodType>(answer: T) =>
  z.record(z.string(), z.union([Invalid, answer]));

const ExpectedSchema = z.strictObject({
  persona: z.enum(PERSONAS),
  address: z.email(),
  messages: z.record(
    z.string(),
    z.strictObject({
      folder: MailFolderSchema,
      stageOne: StageOneVerdictSchema,
      category: CategorySchema,
      facts: z.array(JobFactsSchema).nullable(),
      ownReply: z.boolean(),
      invalid: z.boolean(),
    }),
  ),
  profile: z.strictObject({
    answers: z.strictObject(
      Object.fromEntries(
        CORE_PROFILE_KEYS.map((key) => [
          key,
          z.strictObject({ values: PROFILE_VALUE_SCHEMAS[key], evidence: z.array(z.string()) }),
        ]),
      ),
    ),
    extraQuestions: z.array(z.strictObject({ slug: ExtraSlugSchema, label: z.string() })).max(5),
  }),
});

const EnvelopeEntrySchema = EnvelopeSchema.omit({ uid: true, uidValidity: true, date: true })
  .extend({
    file: z.string().regex(/^(inbox|sent)\/\d{4}\.eml$/),
    minutesAgo: z.number().int().positive(),
  })
  .strict();

const regions = new Intl.DisplayNames(["en"], { type: "region" });
const currencies = new Set(Intl.supportedValuesOf("currency"));

/** Every ISO country and currency code anywhere in a value, by the key it sits under. */
function codes(
  value: unknown,
  out = { countries: new Set<string>(), currencies: new Set<string>() },
) {
  if (Array.isArray(value)) for (const v of value) codes(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "country" && typeof v === "string") out.countries.add(v);
      else if (k === "currency" && typeof v === "string") out.currencies.add(v);
      else codes(v, out);
    }
  }
  return out;
}

describe.each(PERSONAS)("the %s fixtures", (persona) => {
  const expected = ExpectedSchema.parse(read(`${persona}/expected.json`));
  const envelopes = z.array(EnvelopeEntrySchema).parse(read(`${persona}/envelopes.json`));

  it("list every message's envelope in the shape packages/schema defines", () => {
    expect(envelopes.map((e) => e.messageId).sort()).toEqual(Object.keys(expected.messages).sort());
  });

  it("answer classify.v1, extract.v1 and prefs.v1 with valid structured output", () => {
    const classify = answerFile(z.strictObject({ category: CategorySchema })).parse(
      read(`ai/${persona}/classify.json`),
    );
    const extract = answerFile(z.strictObject({ roles: z.array(JobFactsSchema) })).parse(
      read(`ai/${persona}/extract.json`),
    );
    const prefs = answerFile(z.strictObject({ preferences: z.unknown() })).parse(
      read(`ai/${persona}/prefs.json`),
    );
    const valid = <T>(file: Record<string, T | { invalid: true }>) =>
      Object.entries(file).filter((e): e is [string, T] => !("invalid" in (e[1] as object)));
    ClassifyOutputSchema.parse({
      items: valid(classify).map(([messageId, a]) => ({ messageId, ...a })),
    });
    for (const [messageId, a] of valid(extract)) ExtractOutputSchema.parse({ messageId, ...a });
    PrefsOutputSchema.parse({ items: valid(prefs).map(([messageId, a]) => ({ messageId, ...a })) });
    expect(Object.keys(classify)).toHaveLength(envelopes.length);
  });

  it("answer intake.v1 with at most five valid extra questions", () => {
    IntakeExtraOutputSchema.parse(read(`ai/${persona}/intake.json`));
  });

  it("use real ISO 3166 countries and ISO 4217 currencies", () => {
    const found = codes([
      expected,
      read(`ai/${persona}/extract.json`),
      read(`ai/${persona}/prefs.json`),
    ]);
    expect(found.currencies.size).toBeGreaterThan(0);
    for (const c of found.countries) {
      expect(regions.of(c), c).not.toBe(c);
      expect(["EU", "EZ", "UN"]).not.toContain(c);
    }
    for (const c of found.currencies) expect(currencies.has(c), c).toBe(true);
  });

  it("give every core key an answer of its ProfileEntry value shape", () => {
    expect(Object.keys(expected.profile.answers)).toEqual([...CORE_PROFILE_KEYS]);
  });
});

describe("the shared fake-AI answers", () => {
  it("are valid intake.v1 and ai.test.v1 output", () => {
    expect(IntakeExtraOutputSchema.parse(read("ai/none/intake.json"))).toEqual({ questions: [] });
    AiTestOutputSchema.parse(read("ai/ai.test.json"));
  });
});
