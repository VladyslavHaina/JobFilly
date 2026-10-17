import { z } from "zod";
import { CountryCodeSchema, TextSchema } from "./common";
import { WorkModeSchema } from "./facts";

// focus.v1 (MVP 3, F1.1): a re-run of setup's hint and what it asks the scan to focus on. A leaf
// module, so the task output schemas (ai-output.ts) can name it without an import cycle.

/**
 * What a re-run's hint asks the scan to focus on, as focus.v1 reads it (F1.1): the countries
 * (ISO 3166) and cities, working languages (ISO 639-1), work modes and contract words the hint
 * names, and any other words in it worth looking for. Every list may be empty. Stored with the
 * scan (scans.focus); the re-run reads matching mail first and its intake weighs it.
 */
export const ScanFocusSchema = z.object({
  countries: z.array(CountryCodeSchema),
  cities: z.array(TextSchema),
  languages: z.array(z.string().regex(/^[a-z]{2}$/, "an ISO 639-1 code")),
  workModes: z.array(WorkModeSchema),
  contracts: z.array(TextSchema),
  words: z.array(TextSchema),
});
export type ScanFocus = z.infer<typeof ScanFocusSchema>;

/** focus.v1's input: the hint (untrusted, any language). */
export const FocusTaskInputSchema = z.object({ hint: z.string() });
export type FocusTaskInput = z.infer<typeof FocusTaskInputSchema>;
