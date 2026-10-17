import { expect, test } from "@playwright/test";
import { fixturesDir, personaPaths, readJson } from "../../fixtures/format.ts";
import { type ExpectedFileMvp3, MARIA_PROFILES } from "../../fixtures/format-mvp3.ts";
import {
  cvName,
  type Delivery,
  deliveriesOf,
  delivery,
  errorsSince,
  fitScore,
  logMark,
  logSince,
  openMessage,
  roleParts,
  signIn,
  workspaceIdOf,
} from "../shared.ts";

// S2 of docs/mvp/MVP-3.md: roles go to the right profile (F1.3, F1.4). Once S1 confirmed
// "Germany permanent", every role is assigned to the profile it fits best, by fit alone (TBD-451),
// with the reason in plain words: the Munich and Hamburg roles to the new profile, the remote EU
// roles to the first one, as expected.json's mvp3.assignments says. Maria then puts the first
// Munich role in "My job search" by hand: its match is worked out against that profile (München
// isn't one of its places, a hard conflict) and its CV chosen again; then she puts it back.

const expected = readJson<ExpectedFileMvp3>(`${fixturesDir()}${personaPaths("maria").expected}`);
const assignments = expected.mvp3?.assignments ?? {};
const GERMANY = MARIA_PROFILES.germany;
const FIRST = MARIA_PROFILES.first;
const MUNICH = delivery("munich-1");
const BACKEND_DE = cvName("maria", "Backend (DE)");

const S1 = deliveriesOf("S1");

/** The words a role's assignment starts with: its place, or that it is remote (core assign). */
function placeWords(d: Delivery): string {
  const [role] = d.roles;
  if (role?.facts.workMode === "remote") return "Remote role";
  const place = role?.facts.places[0];
  return `${place?.city ?? place?.country} role`;
}

test("S2: roles go to the right profile", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  const mark = logMark();
  await signIn(page, "maria");
  await expect(page.getByRole("heading", { name: "Job inbox", exact: true })).toBeVisible();
  const workspaceId = workspaceIdOf(page);
  expect(Object.keys(assignments)).toHaveLength(S1.length);

  for (const d of S1) {
    const profile = assignments[`${d.messageId}#0`];
    await test.step(`${d.id} shows "→ '${profile}'" with the reason`, async () => {
      expect(profile, `${d.id} has an expected profile`).toBeDefined();
      await openMessage(page, d.subject);
      const parts = roleParts(page);
      // Assigned when the confirm re-evaluated every role, within a minute or so.
      await expect(parts.profile).toContainText(`→ '${profile}'`, { timeout: 120_000 });
      await expect(parts.profile).toContainText(`Profile: ${placeWords(d)}`);
      // Matched with that profile and its CVs: a CV is chosen, and skills come from it.
      await expect(parts.cv).toContainText("→", { timeout: 60_000 });
      await expect(parts.cv).not.toContainText("No CV uploaded yet");
      await fitScore(parts.fit);
      await expect(
        parts.fit
          .getByText("Skills you have", { exact: true })
          .locator("xpath=following-sibling::p[1]"),
      ).not.toHaveText("None");
    });
  }

  const choice = page.getByLabel("Put role 1 in another profile", { exact: true });
  const reasons = roleParts(page).fit.getByRole("list", {
    name: "Why this fit score",
    exact: true,
  });
  await test.step(`the Munich role in "${GERMANY}": its places fit`, async () => {
    await openMessage(page, MUNICH.subject);
    const { profile, cv, fit } = roleParts(page);
    await expect(profile).toContainText(`→ '${GERMANY}'`);
    await expect(choice).toHaveValue(/.+/);
    const { capped } = await fitScore(fit);
    expect(capped, "no place conflict in the profile that names München").toBe(false);
    await expect(reasons).toContainText(/fits your 'München/);
    await expect(cv).toContainText(`→ ${BACKEND_DE}`);
  });

  await test.step(`she puts it in "${FIRST}" by hand: its match and CV choice follow`, async () => {
    await choice.selectOption({ label: FIRST });
    const { profile, cv, fit } = roleParts(page);
    await expect(profile).toContainText(`Chosen by hand → '${FIRST}'`);
    // Evaluated again against her first profile, whose only place is Berlin.
    await expect(reasons).toContainText("not one of your places", { timeout: 60_000 });
    await expect.poll(async () => (await fitScore(fit)).capped, { timeout: 60_000 }).toBe(true);
    await expect(fit).toContainText("Capped at 40: a hard conflict");
    await expect(cv).toContainText(`→ ${BACKEND_DE}`);
    await page.reload();
    await expect(roleParts(page).profile).toContainText(`Chosen by hand → '${FIRST}'`);
  });

  await test.step(`and puts it back in "${GERMANY}"`, async () => {
    await choice.selectOption({ label: GERMANY });
    const { profile, fit } = roleParts(page);
    await expect(profile).toContainText(`Chosen by hand → '${GERMANY}'`);
    await expect(reasons).toContainText(/fits your 'München/, { timeout: 60_000 });
    await expect.poll(async () => (await fitScore(fit)).capped, { timeout: 60_000 }).toBe(false);
  });

  await test.step("logs: profile.assigned, automatic and by hand, no errors", async () => {
    const assigned = logSince(mark).filter(
      (l) => l.workspaceId === workspaceId && l.event === "profile.assigned",
    );
    expect(assigned.filter((l) => l.source === "you").length).toBeGreaterThanOrEqual(2);
    expect(assigned.every((l) => typeof l.profileId === "string")).toBe(true);
    expect(errorsSince(mark)).toEqual([]);
  });
});
