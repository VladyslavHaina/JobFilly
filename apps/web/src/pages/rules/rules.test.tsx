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
      // MVP 3 (F2.3): with how many roles the change changes.
      return { ...updated, changed: 0 };
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
        .getByRole("switch", { name: /^Use the rule/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(agencies as HTMLElement)
        .getByRole("switch", { name: /^Use the rule/ })
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
    await userEvent.click(
      within(asia as HTMLElement).getByRole("switch", { name: /^Use the rule/ }),
    );
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.path).toBe(`/api/workspaces/${WS}/profiles/${PROFILE}/rules/${ASIA.id}`);
    expect(patch?.body).toEqual({ enabled: false });
    await vi.waitFor(async () => {
      const [after] = await rows();
      expect(
        within(after as HTMLElement)
          .getByRole("switch", { name: /^Use the rule/ })
          .getAttribute("aria-checked"),
      ).toBe("false");
    });
  });

  it("names the switch by its rule and shows On or Off as the rule is", async () => {
    setup("editor");
    const [asia, agencies] = await rows();
    const asiaSwitch = within(asia as HTMLElement).getByRole("switch", {
      name: `Use the rule "${ASIA.description}"`,
    });
    expect(within(asia as HTMLElement).getByText("On")).toBeTruthy();
    expect(
      within(agencies as HTMLElement)
        .getByRole("switch", { name: `Use the rule "${AGENCIES.description}"` })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(within(agencies as HTMLElement).queryByText("On")).toBeNull();
    expect(within(agencies as HTMLElement).getByText("Off")).toBeTruthy();

    await userEvent.click(asiaSwitch);
    await vi.waitFor(async () => {
      const [after] = await rows();
      expect(within(after as HTMLElement).getByText("Off")).toBeTruthy();
      expect(within(after as HTMLElement).queryByText("On")).toBeNull();
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
      expect(
        (scope.getByRole("switch", { name: /^Use the rule/ }) as HTMLButtonElement).disabled,
      ).toBe(true);
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

describe("rules by hand (MVP 3, F2.1, F2.3)", () => {
  function handApi(rules: Rule[]) {
    let current = rules;
    const requests = fakeApi({
      [`GET ${RULES_PATH}`]: () => ({ items: current }),
      [`POST ${RULES_PATH}`]: (req: FakeRequest) => {
        const body = req.body as Pick<Rule, "when" | "then"> & { description: string };
        const created = rule({
          id: "00000000-0000-4000-8000-0000000000e9",
          ...body,
          description: body.description || "Hide roles whose hours are within UTC+5 to UTC+14",
          source: "you",
        });
        current = [...current, created];
        return json({ ...created, changed: 4 }, 201);
      },
      [`PATCH ${RULES_PATH}/:id`]: (req: FakeRequest, params: Record<string, string>) => {
        const found = current.find((r) => r.id === params.id) as Rule;
        const updated = { ...found, ...(req.body as Partial<Rule>) };
        current = current.map((r) => (r.id === updated.id ? updated : r));
        return { ...updated, changed: 0 };
      },
    });
    renderInWorkspace(<RulesList workspaceId={WS} profileId={PROFILE} />, { role: "editor" });
    return requests;
  }

  it("adds a rule from its conditions and action, and says how many roles it changes", async () => {
    const requests = handApi([]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add a rule" }));
    const form = within(screen.getByRole("form", { name: "New rule" }));
    // Nothing is picked for the user: no rule can be saved until they choose a condition.
    expect(form.getByLabelText("Fact")).toHaveProperty("value", "");
    expect(form.getByLabelText("Compared")).toHaveProperty("value", "");
    expect(form.getByRole("button", { name: "Save rule" })).toHaveProperty("disabled", true);
    await user.selectOptions(form.getByLabelText("Fact"), "Working hours (UTC offsets)");
    expect(form.getByRole("button", { name: "Save rule" })).toHaveProperty("disabled", true);
    await user.selectOptions(form.getByLabelText("Compared"), "is within");
    expect(form.getByLabelText("From")).toHaveProperty("value", "");
    await user.clear(form.getByLabelText("From"));
    await user.type(form.getByLabelText("From"), "UTC+05:00");
    await user.clear(form.getByLabelText("To"));
    await user.type(form.getByLabelText("To"), "UTC+14:00");
    await user.selectOptions(form.getByLabelText("Then"), "Hide the role");
    await user.click(form.getByRole("button", { name: "Save rule" }));
    expect(
      await screen.findByText("Saved. It changes 4 roles; your inbox shows them within a minute."),
    ).toBeTruthy();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      when: [{ fact: "timeZones", op: "within", value: { from: "UTC+05:00", to: "UTC+14:00" } }],
      then: "hide",
      description: "",
    });
    const [added] = await rows();
    expect(added?.textContent).toContain("Hide roles whose hours are within UTC+5 to UTC+14");
  });

  it("changes a rule's conditions and action", async () => {
    const requests = handApi([AGENCIES]);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: `Change the rule "${AGENCIES.description}"`,
      }),
    );
    const form = within(screen.getByRole("form", { name: "Change the rule" }));
    const words = form.getByLabelText("Words, separated by commas");
    expect(words).toHaveProperty("value", "Hays");
    await user.type(words, ", Randstad");
    await user.selectOptions(form.getByLabelText("Then"), "Ask me before replying");
    await user.click(form.getByRole("button", { name: "Add a condition" }));
    await user.click(form.getByRole("button", { name: "Remove condition 2" }));
    await user.click(form.getByRole("button", { name: "Save rule" }));
    expect(await screen.findByText("Saved. It changes none of your current roles.")).toBeTruthy();
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
      when: [{ fact: "agency", op: "in", value: ["Hays", "Randstad"] }],
      then: "ask_first",
      description: AGENCIES.description,
    });
  });
});
