import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge, Button, Dialog, Switch, TagInput, Textarea } from "./index";

// The building blocks MVP 2's pages share, each found by its accessible name.

afterEach(cleanup);

describe("Switch", () => {
  it("is a switch named by its label that flips on click and keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Hide Asian time zones" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Hide Asian time zones" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    toggle.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("can't be flipped while disabled, and keeps a hidden label for screen readers", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch label="Rule on" checked onChange={onChange} disabled hideLabel />);
    const toggle = screen.getByRole("switch", { name: "Rule on" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await user.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Textarea", () => {
  it("is labelled, with its hint and error described", async () => {
    const user = userEvent.setup();
    render(<Textarea label="Reply" hint="Only your text" error="Too long" defaultValue="" />);
    const field = screen.getByLabelText("Reply");
    await user.type(field, "Hallo{enter}Welt");
    expect((field as HTMLTextAreaElement).value).toBe("Hallo\nWelt");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Too long")).toBeTruthy();
  });
});

describe("TagInput", () => {
  function Tags({ initial }: { initial: string[] }) {
    const [tags, setTags] = useState(initial);
    return <TagInput label="Tags" tags={tags} onChange={setTags} />;
  }

  it("adds what is typed on Enter or a comma, once, and removes a tag by its button", async () => {
    const user = userEvent.setup();
    render(<Tags initial={["backend"]} />);
    const field = screen.getByLabelText("Tags", { selector: "input" });
    await user.type(field, "preferred{enter}");
    await user.type(field, "German,");
    await user.type(field, "PREFERRED{enter}");
    const list = screen.getByRole("list", { name: "Tags" });
    expect(list.textContent).toBe("backend×preferred×German×");
    await user.click(screen.getByRole("button", { name: "Remove backend" }));
    expect(screen.getByRole("list", { name: "Tags" }).textContent).toBe("preferred×German×");
  });
});

describe("Badge", () => {
  it("shows its text and can carry a fuller name", () => {
    render(
      <Badge tone="danger" label="Sender: high risk">
        High risk
      </Badge>,
    );
    expect(screen.getByRole("img", { name: "Sender: high risk" }).textContent).toBe("High risk");
  });
});

describe("Dialog", () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Edit</Button>
        <Dialog
          title="Edit the change"
          open={open}
          onClose={() => setOpen(false)}
          actions={<Button onClick={() => setOpen(false)}>Done</Button>}
        >
          The time-zone range
        </Dialog>
      </>
    );
  }

  it("opens labelled by its title, takes focus, and closes with Esc or Close", async () => {
    const user = userEvent.setup();
    render(<Example />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit the change" });
    expect(document.activeElement).toBe(dialog);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
