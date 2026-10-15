import type { Role, Rule } from "@jobfilly/schema";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type FakeRequest,
  fakeApi,
  json,
  renderInWorkspace,
  testWorkspace,
} from "../../components/testing";
import { RulesList } from ".";

// The Rules list on the profile page (F3.1, F3.5): each rule in plain words with its source, a
// Switch and Remove for editors, both disabled for viewers.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WS = testWorkspace().id;
const PROFILE = "00000000-0000-4000-8000-0000000000f1";

const rule = (overrides: Partial<Rule>): Rule => ({
  id: "00000000-0000-4000-8000-0000000000e1",
  profileId: PROFILE,
  description: "Hide roles whose hours are outside UTC−1 to UTC+3",
  when: [{ fact: "timeZones", op: "outside", value: { from: "UTC-01:00", to: "UTC+03:00" } }],
  then: "hide",
  enabled: true,
  source: "assistant",
  createdAt: "2026-10-15T12:00:00.000Z",
  createdBy: null,
  ...overrides,
});

const ASIA = rule({});
const AGENCIES = rule({
  id: "00000000-0000-4000-8000-0000000000e2",
  description: "Don't draft replies to roles whose agency is Hays",
  then: "no_draft",
  when: [{ fact: "agency", op: "in", value: ["Hays"] }],
  enabled: false,
  source: "you",
});

const RULES_PATH = `/api/workspaces/:ws/profiles/:pid/rules`;

function setup(role: Role, rules: Rule[] = [ASIA, AGENCIES]) {
  let current = rules;
  const requests = fakeApi({
    [`GET ${RULES_PATH}`]: () => ({ items: current }),
    [`PATCH ${RULES_PATH}/:id`]: (req: FakeRequest, params: Record<string, string>) => {
      const found = current.find((r) => r.id === params.id);
      if (!found) return json({ error: "not_found" }, 404);
      const updated = { ...found, enabled: (req.body as { enabled: boolean }).enabled };
      current = current.map((r) => (r.id === updated.id ? updated : r));
      return updated;
    },
    [`DELETE ${RULES_PATH}/:id`]: (_req: FakeRequest, params: Record<string, string>) => {
      current = current.filter((r) => r.id !== params.id);
      return undefined;
    },
  });
  renderInWorkspace(<RulesList workspaceId={WS} profileId={PROFILE} />, { role });
  return requests;
}

const rows = async () =>
  within(await screen.findByRole("list", { name: "Rules" })).getAllByRole("listitem");

describe("RulesList", () => {
  it("shows each rule in plain words with where it came from", async () => {
    setup("editor");
    const [asia, agencies] = await rows();
    expect(asia?.textContent).toContain("Hide roles whose hours are outside UTC−1 to UTC+3");
    expect(asia?.textContent).toContain("From the assistant");
    expect(agencies?.textContent).toContain("Don't draft replies to roles whose agency is Hays");
    expect(agencies?.textContent).toContain("Added by you");
    expect(agencies?.textContent).toContain("Off");
    expect(
      within(asia as HTMLElement)
        .getByRole("switch", { name: "On" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(agencies as HTMLElement)
        .getByRole("switch", { name: "On" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("names a rule by the same plain words in its row and on its Remove button", async () => {
    // The server stores a rule given no description with the words of its conditions, so a
    // rule added with "" reaches the list as these words.
    setup("editor", [ASIA]);
    const [asia] = await rows();
    const scope = within(asia as HTMLElement);
    expect(scope.getByText("Hide roles whose hours are outside UTC−1 to UTC+3")).toBeTruthy();
    expect(
      scope.getByRole("button", {
        name: 'Remove the rule "Hide roles whose hours are outside UTC−1 to UTC+3"',
      }),
    ).toBeTruthy();
  });

  it("lets an editor switch a rule off", async () => {
    const requests = setup("editor");
    const [asia] = await rows();
    await userEvent.click(within(asia as HTMLElement).getByRole("switch", { name: "On" }));
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.path).toBe(`/api/workspaces/${WS}/profiles/${PROFILE}/rules/${ASIA.id}`);
    expect(patch?.body).toEqual({ enabled: false });
    await vi.waitFor(async () => {
      const [after] = await rows();
      expect(
        within(after as HTMLElement)
          .getByRole("switch", { name: "On" })
          .getAttribute("aria-checked"),
      ).toBe("false");
    });
  });

  it("lets an editor remove a rule", async () => {
    const requests = setup("editor");
    const [asia] = await rows();
    await userEvent.click(
      within(asia as HTMLElement).getByRole("button", {
        name: `Remove the rule "${ASIA.description}"`,
      }),
    );
    expect(requests.find((r) => r.method === "DELETE")?.path).toBe(
      `/api/workspaces/${WS}/profiles/${PROFILE}/rules/${ASIA.id}`,
    );
    await vi.waitFor(async () => expect(await rows()).toHaveLength(1));
  });

  it("disables the Switch and Remove for viewers", async () => {
    const requests = setup("viewer");
    for (const row of await rows()) {
      const scope = within(row);
      expect((scope.getByRole("switch", { name: "On" }) as HTMLButtonElement).disabled).toBe(true);
      expect(
        (scope.getByRole("button", { name: /^Remove the rule/ }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    expect(screen.getByText(/Only editors and admins can change them/)).toBeTruthy();
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("says when there are no rules yet", async () => {
    setup("editor", []);
    expect(await screen.findByText("No rules yet. Ask the assistant to add one.")).toBeTruthy();
  });
});
