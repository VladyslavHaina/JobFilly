import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { collectStored, compareWithExpected, type GetJson } from "../../fixtures/compare.ts";
import { f53ProofSkipReason, missingF53ProofNeeds } from "../../fixtures/f53-proof.ts";
import { PERSONA_ADDRESSES, PERSONAS, type Persona } from "../../fixtures/format.ts";

// The F5.3 proof, not a scenario spec: it walks no scenario and clicks nothing. With the fake AI,
// every analysed message's category and facts on both personas must equal expected.json.
//
// It runs after every MVP 1 scenario spec (its name sorts last in specs/mvp-1, which
// e2e/stack.test.ts checks), so after Maria's first scan (S3), Tom's first scan (S7) and Maria's
// Analyze them runs (S8, then S9, which ends "done"): every message any of them analysed is in
// the app. Like a probe, it signs in with an API session of its own (the browsers' sessions stay
// as they are), reads every message the app stores in the persona's own workspace, with the roles
// of job mail and of corrected messages, and requires compareWithExpected to find no difference.
// `complete`: every compared message must be stored and analysed, none pending or missing.
// Categories a person corrected in S5 and S6 (F5.4) are left out; their roles are compared.
// It only reads, so the specs after it start from the state the scenarios left.
//
// The guard (fixtures/f53-proof.ts): the proof depends on the scenario specs that create its
// state, F53_PROOF_NEEDS (S1, S3, S5, S6, S7, S8 and S9). Before the codify step this directory
// holds only 00-stack and this file, nothing has registered, scanned or analysed what it reads,
// and the walkthrough covers F5.3, so the proof is skipped with that reason. As soon as any
// scenario spec is here it runs with no skip: first it requires every spec it needs to be present,
// so one left uncodified or renamed fails it by name instead of silencing it, then the comparison.
// e2e/stack.test.ts pins the guard, the list and the scenario specs' names.
const entries = readdirSync(import.meta.dirname);
const skipReason = f53ProofSkipReason(entries);
test.skip(skipReason !== undefined, skipReason ?? "");

/** The login passwords the scenarios register the personas with (S1, S6). */
const LOGIN_PASSWORDS: Record<Persona, string> = {
  maria: "E2E-SECRET-maria-login",
  tom: "E2E-SECRET-tom-login",
};

for (const persona of PERSONAS) {
  test(`F5.3: what the app stores for ${persona} equals expected.json`, async ({
    playwright,
    baseURL,
  }) => {
    expect(
      missingF53ProofNeeds(entries),
      "codified, so every spec the proof needs must be present",
    ).toEqual([]);

    const origin = new URL(baseURL ?? "http://127.0.0.1:8080").origin;
    const api = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { Origin: origin },
    });
    try {
      const signIn = await api.post("/api/auth/sign-in", {
        data: { email: PERSONA_ADDRESSES[persona], password: LOGIN_PASSWORDS[persona] },
      });
      expect(signIn.status(), `${persona} signs in`).toBe(200);
      const get: GetJson = async (path) => {
        const response = await api.get(path);
        if (!response.ok()) throw new Error(`GET ${path}: ${response.status()}`);
        return response.json();
      };

      const workspaces = (await get("/api/workspaces")) as {
        items: { id: string; isOwner: boolean }[];
      };
      const own = workspaces.items.filter((w) => w.isOwner);
      expect(own, `${persona}'s own workspace`).toHaveLength(1);
      const workspaceId = own[0]?.id ?? "";

      const stored = await collectStored(get, workspaceId);
      expect(compareWithExpected(persona, stored, { complete: true })).toEqual([]);

      expect((await api.post("/api/auth/sign-out")).status()).toBe(204);
    } finally {
      await api.dispose();
    }
  });
}
