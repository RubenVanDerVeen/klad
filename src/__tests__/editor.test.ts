// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createEditor, getText, setText } from "../editor";

describe("editor dirty handling", () => {
  it("setText (programmatic load) does not fire onDocChanged", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onDocChanged = vi.fn();
    const view = createEditor(parent, onDocChanged, () => {}, true);
    onDocChanged.mockClear(); // ignore any construction-time callbacks
    setText(view, "hello world");
    expect(getText(view)).toBe("hello world");
    expect(onDocChanged).not.toHaveBeenCalled();
    view.destroy();
  });

  it("an un-annotated dispatch (user edit) fires onDocChanged", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onDocChanged = vi.fn();
    const view = createEditor(parent, onDocChanged, () => {}, true);
    onDocChanged.mockClear();
    view.dispatch({ changes: { from: 0, to: 0, insert: "x" } });
    expect(onDocChanged).toHaveBeenCalledTimes(1);
    view.destroy();
  });
});