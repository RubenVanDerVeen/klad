// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { renderPreviewNow, setPreviewKind, setPreviewVisible } from "../preview";

const invokeMock = vi.mocked(invoke);

describe("typst error bar", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="content"><div id="preview"></div></div>';
    invokeMock.mockReset();
    setPreviewKind("typ");
    setPreviewVisible(true);
  });

  it("renders inside #preview with first error, count, and full-text title", async () => {
    invokeMock.mockResolvedValue({
      pages: [],
      errors: [
        { message: "unknown variable: x", line: 2, file: "main.typ" },
        { message: "second failure", line: 5, file: null },
      ],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    const bar = document.querySelector<HTMLElement>("#preview > #preview-error")!;
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector<HTMLElement>(".preview-error-msg")!.textContent).toBe(
      "line 2: unknown variable: x",
    );
    expect(bar.querySelector<HTMLElement>(".preview-error-count")!.textContent).toBe("+1");
    expect(bar.title).toBe("line 2: unknown variable: x (+1 more)");
    expect(bar.querySelector<HTMLElement>(".preview-error-close")).not.toBeNull();
  });

  it("omits the count badge for a single error", async () => {
    invokeMock.mockResolvedValue({
      pages: [],
      errors: [{ message: "boom", line: null, file: null }],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    const bar = document.querySelector<HTMLElement>("#preview > #preview-error")!;
    expect(bar.querySelector<HTMLElement>(".preview-error-msg")!.textContent).toBe("boom");
    expect(bar.querySelector<HTMLElement>(".preview-error-count")!.textContent).toBe("");
  });

  it("dismiss button hides the bar", async () => {
    invokeMock.mockResolvedValue({
      pages: [],
      errors: [{ message: "boom", line: null, file: null }],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    (document.querySelector<HTMLElement>("#preview > #preview-error .preview-error-close")!).
      click();
    const bar = document.querySelector<HTMLElement>("#preview > #preview-error")!;
    expect(bar.hidden).toBe(true);
  });

  it("hides the bar when a later compile succeeds", async () => {
    invokeMock.mockResolvedValueOnce({
      pages: [],
      errors: [{ message: "boom", line: null, file: null }],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    invokeMock.mockResolvedValueOnce({ pages: ["<svg/>"], errors: [] });
    renderPreviewNow("#typst fixed");
    await vi.waitFor(() => {
      // success wipes pane children, so the bar is gone from the DOM entirely
      expect(document.querySelector("#preview > #preview-error")).toBe(null);
    });
    expect(document.querySelector("#preview .typst-page")).not.toBeNull();
  });

  it("recreates the bar after pane content was replaced (innerHTML orphan)", async () => {
    invokeMock.mockResolvedValueOnce({
      pages: [],
      errors: [{ message: "boom", line: 1, file: null }],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    invokeMock.mockResolvedValueOnce({ pages: ["<svg/>"], errors: [] });
    renderPreviewNow("#typst ok"); // success wipes pane children incl. the bar
    await vi.waitFor(() => {
      expect(document.querySelector("#preview .typst-page")).not.toBeNull();
    });
    invokeMock.mockResolvedValueOnce({
      pages: [],
      errors: [{ message: "boom again", line: 1, file: null }],
    });
    renderPreviewNow("#typst broken");
    await vi.waitFor(() => {
      const bar = document.querySelector<HTMLElement>("#preview > #preview-error");
      expect(bar?.hidden).toBe(false);
      expect(bar?.querySelector<HTMLElement>(".preview-error-msg")?.textContent).toBe(
        "line 1: boom again",
      );
    });
  });
});
