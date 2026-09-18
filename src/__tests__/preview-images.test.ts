// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset:${p}`,
  invoke: vi.fn(),
}));

import { renderPreviewNow, setPreviewBaseDir, setPreviewVisible } from "../preview";

describe("preview image resolution wiring", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="content"><div id="preview"></div></div>';
    setPreviewVisible(true);
  });

  it("rewrites relative image src against the active base dir", () => {
    setPreviewBaseDir("C:/docs");
    renderPreviewNow("![pic](img/pic.png)");
    const img = document.querySelector("#preview img")!;
    expect(img.getAttribute("src")).toBe("asset:C:/docs/img/pic.png");
  });

  it("leaves images alone without a base dir", () => {
    setPreviewBaseDir(null);
    renderPreviewNow("![pic](img/pic.png)");
    expect(document.querySelector("#preview img")!.getAttribute("src")).toBe("img/pic.png");
  });
});
