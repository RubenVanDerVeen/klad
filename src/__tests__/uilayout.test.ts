// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_UI_LAYOUT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampPaneWidth,
  parseUiLayout,
  previewBounds,
  loadUiLayout,
  saveUiLayout,
  applyUiLayout,
  getUiLayout,
  initPanelSplitters,
  type UiLayout,
} from "../uilayout";

describe("clampPaneWidth", () => {
  it("clamps into range and rounds", () => {
    expect(clampPaneWidth(10, 140, 480)).toBe(140);
    expect(clampPaneWidth(9999, 140, 480)).toBe(480);
    expect(clampPaneWidth(220.6, 140, 480)).toBe(221);
  });
  it("maps non-finite to min", () => {
    expect(clampPaneWidth(NaN, 140, 480)).toBe(140);
    expect(clampPaneWidth(Infinity, 140, 480)).toBe(480);
  });
});

describe("previewBounds", () => {
  it("leaves room for editor when sidebar visible", () => {
    // 1200 - 220 sidebar - 240 editor = 740
    expect(previewBounds(1200, 220, false)).toEqual({ min: 200, max: 740 });
  });
  it("ignores sidebar width when hidden", () => {
    // 1200 - 0 - 240 = 960
    expect(previewBounds(1200, 220, true)).toEqual({ min: 200, max: 960 });
  });
  it("floors max at PREVIEW_MIN on tiny windows", () => {
    expect(previewBounds(300, 220, false).max).toBe(200);
  });
});

describe("parseUiLayout", () => {
  it("returns defaults for junk", () => {
    expect(parseUiLayout(null)).toEqual(DEFAULT_UI_LAYOUT);
    expect(parseUiLayout("nope")).toEqual(DEFAULT_UI_LAYOUT);
    expect(parseUiLayout(42)).toEqual(DEFAULT_UI_LAYOUT);
    expect(parseUiLayout({})).toEqual(DEFAULT_UI_LAYOUT);
  });
  it("clamps out-of-range values and coerces hidden to boolean", () => {
    const parsed = parseUiLayout({ sidebarWidth: 9999, previewWidth: 5, sidebarHidden: 1 });
    expect(parsed.sidebarWidth).toBe(SIDEBAR_MAX);
    expect(parsed.previewWidth).toBe(200);
    expect(parsed.sidebarHidden).toBe(true);
  });
  it("clamps absurd preview width to PREVIEW_MAX", () => {
    expect(parseUiLayout({ sidebarWidth: 220, previewWidth: 99999, sidebarHidden: false }).previewWidth).toBe(3200);
  });
  it("accepts a valid layout unchanged", () => {
    const good: UiLayout = { sidebarWidth: 300, previewWidth: 420, sidebarHidden: true };
    expect(parseUiLayout(good)).toEqual(good);
  });
});

describe("localStorage round-trip", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("saves and loads", () => {
    saveUiLayout({ sidebarWidth: 260, previewWidth: 400, sidebarHidden: true });
    expect(loadUiLayout()).toEqual({ sidebarWidth: 260, previewWidth: 400, sidebarHidden: true });
  });
  it("load with corrupt data falls back to defaults", () => {
    localStorage.setItem("klad-ui", "{{{");
    expect(loadUiLayout()).toEqual(DEFAULT_UI_LAYOUT);
  });
});

describe("applyUiLayout / getUiLayout", () => {
  beforeEach(() => {
    document.body.innerHTML = `<main id="content"><aside id="sidebar"></aside><div id="sidebar-handle"></div><div id="editor"></div><div id="preview-handle"></div><div id="preview"></div></main>`;
  });

  it("flips sidebar hidden attribute and records state", () => {
    applyUiLayout({ sidebarWidth: 300, previewWidth: 400, sidebarHidden: true });
    expect(document.getElementById("sidebar")!.hasAttribute("hidden")).toBe(true);
    expect(getUiLayout()).toEqual({ sidebarWidth: 300, previewWidth: 400, sidebarHidden: true });

    applyUiLayout({ sidebarWidth: 300, previewWidth: 400, sidebarHidden: false });
    expect(document.getElementById("sidebar")!.hasAttribute("hidden")).toBe(false);
  });

  it("writes width custom properties on #content", () => {
    const content = document.getElementById("content")!;
    const spy = vi.spyOn(content.style, "setProperty");
    applyUiLayout({ sidebarWidth: 260, previewWidth: 410, sidebarHidden: false });
    expect(spy).toHaveBeenCalledWith("--sidebar-w", "260px");
    expect(spy).toHaveBeenCalledWith("--preview-w", "410px");
  });

  it("no-ops without DOM elements", () => {
    document.body.innerHTML = "";
    expect(() => applyUiLayout({ ...DEFAULT_UI_LAYOUT })).not.toThrow();
  });
});

describe("initPanelSplitters", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `<main id="content" style="width:1000px;position:relative;"><aside id="sidebar"></aside><div id="sidebar-handle"></div><div id="editor"></div><div id="preview-handle"></div><div id="preview"></div></main>`;
  });
  afterEach(() => localStorage.clear());

  it("no-ops without DOM elements", () => {
    document.body.innerHTML = "";
    expect(() => initPanelSplitters()).not.toThrow();
  });

  it("dblclick on sidebar handle resets width to default and saves", () => {
    applyUiLayout({ sidebarWidth: 400, previewWidth: 400, sidebarHidden: false });
    initPanelSplitters();
    document.getElementById("sidebar-handle")!.dispatchEvent(new Event("dblclick"));
    expect(getUiLayout().sidebarWidth).toBe(DEFAULT_UI_LAYOUT.sidebarWidth);
    expect(localStorage.getItem("klad-ui")).not.toBeNull();
  });

  it("pointermove on sidebar handle updates width within clamps", () => {
    // jsdom getBoundingClientRect returns zeros; stub content rect via getBoundingClientRect mock
    const content = document.getElementById("content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue(
      { left: 100, right: 1100, width: 1000, top: 0, height: 0, x: 100, y: 0, bottom: 0, toJSON: () => ({}) } as DOMRect,
    );
    applyUiLayout({ sidebarWidth: 220, previewWidth: 380, sidebarHidden: false });
    initPanelSplitters();
    const handle = document.getElementById("sidebar-handle")!;
    handle.setPointerCapture = () => {};
    // jsdom has no PointerEvent constructor; listeners only read clientX, so MouseEvent works
    handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 350 }));
    handle.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 350 }));
    expect(getUiLayout().sidebarWidth).toBe(250); // 350 - 100
    handle.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 99999 }));
    expect(getUiLayout().sidebarWidth).toBe(SIDEBAR_MAX);
    handle.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem("klad-ui")!).sidebarWidth).toBe(SIDEBAR_MAX);
  });
});
