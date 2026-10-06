# Plan: Resizable & Collapsible Panels

Spec: `docs/artifacts/features/panel-resize-collapse/2026-10-06-panel-resize-collapse-design.md`
Branch: `feat/panel-resize-collapse` (cut from default branch). Commits at task boundaries (Conventional Commits, carve-out per AGENTS.md).

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/uilayout.ts` | create | Layout state (parse/persist/apply) + splitter drag logic |
| `src/__tests__/uilayout.test.ts` | create | Unit + jsdom tests for the above |
| `index.html` | modify | Two `.pane-handle` divs inside `#content` |
| `src/styles.css` | modify | Width vars, handle styling, hidden-handle rules |
| `src/menu.ts` | modify | View > Toggle Sidebar CheckMenuItem, handles, actions |
| `src/main.ts` | modify | Wire actions, startup restore, splitter init |

Verification commands: `npm test` (Vitest), `npm run build` (type-checks + bundles). No Rust changes; do not touch `src-tauri/`.

---

### Task 1: `src/uilayout.ts` - layout state + splitters

**Files:**
- Create: `src/uilayout.ts`
- Test: `src/__tests__/uilayout.test.ts`

**Depends:** none

**Interfaces:**
- Consumes: nothing (new module; follows `src/workspace.ts` / `src/settings.ts` localStorage pattern).
- Produces:
  - `interface UiLayout { sidebarWidth: number; previewWidth: number; sidebarHidden: boolean }`
  - `const DEFAULT_UI_LAYOUT: UiLayout` (`{ 220, 380, false }`)
  - `const SIDEBAR_MIN = 140, SIDEBAR_MAX = 480, PREVIEW_MIN = 200, PREVIEW_MAX = 3200, EDITOR_MIN = 240` (numbers)
  - `clampPaneWidth(w: number, min: number, max: number): number`
  - `previewBounds(contentWidth: number, sidebarWidth: number, sidebarHidden: boolean): { min: number; max: number }`
  - `parseUiLayout(raw: unknown): UiLayout`
  - `loadUiLayout(): UiLayout`
  - `saveUiLayout(s: UiLayout): void`
  - `applyUiLayout(s: UiLayout): void` - sets `--sidebar-w`/`--preview-w` on `#content`, flips `hidden` on `#sidebar`
  - `getUiLayout(): UiLayout` - copy of current in-memory state
  - `initPanelSplitters(): void` - wires both handles (drag + dblclick reset); no-op when elements absent

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/uilayout.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/uilayout.test.ts`
Expected: FAIL - module `../uilayout` not found.

- [ ] **Step 3: Implement `src/uilayout.ts`**

```ts
// Panel layout state + splitter drag logic (sidebar / editor / preview columns).

export interface UiLayout {
  sidebarWidth: number;
  previewWidth: number;
  sidebarHidden: boolean;
}

export const DEFAULT_UI_LAYOUT: UiLayout = { sidebarWidth: 220, previewWidth: 380, sidebarHidden: false };
export const SIDEBAR_MIN = 140;
export const SIDEBAR_MAX = 480;
export const PREVIEW_MIN = 200;
export const PREVIEW_MAX = 3200;
export const EDITOR_MIN = 240;

const KEY = "klad-ui";

let current: UiLayout = { ...DEFAULT_UI_LAYOUT };

export function clampPaneWidth(w: number, min: number, max: number): number {
  if (!Number.isFinite(w)) return min;
  return Math.min(max, Math.max(min, Math.round(w)));
}

export function previewBounds(
  contentWidth: number,
  sidebarWidth: number,
  sidebarHidden: boolean,
): { min: number; max: number } {
  const avail = contentWidth - (sidebarHidden ? 0 : sidebarWidth) - EDITOR_MIN;
  return { min: PREVIEW_MIN, max: Math.max(PREVIEW_MIN, avail) };
}

// ponytail: shape-checked object parse, not a schema lib - same discipline as parseSettings
export function parseUiLayout(raw: unknown): UiLayout {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_UI_LAYOUT };
  const o = raw as Record<string, unknown>;
  return {
    sidebarWidth: clampPaneWidth(
      typeof o.sidebarWidth === "number" ? o.sidebarWidth : NaN,
      SIDEBAR_MIN,
      SIDEBAR_MAX,
    ),
    previewWidth: clampPaneWidth(
      typeof o.previewWidth === "number" ? o.previewWidth : NaN,
      PREVIEW_MIN,
      PREVIEW_MAX,
    ),
    sidebarHidden: o.sidebarHidden === true,
  };
}

export function loadUiLayout(): UiLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULT_UI_LAYOUT };
    current = parseUiLayout(JSON.parse(raw));
  } catch {
    current = { ...DEFAULT_UI_LAYOUT };
  }
  return { ...current };
}

export function saveUiLayout(s: UiLayout): void {
  current = { ...s };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // quota/unavailable: keep in-memory state only
  }
}

export function getUiLayout(): UiLayout {
  return { ...current };
}

export function applyUiLayout(s: UiLayout): void {
  current = { ...s };
  const content = document.getElementById("content");
  const sidebar = document.getElementById("sidebar");
  if (content) {
    content.style.setProperty("--sidebar-w", `${s.sidebarWidth}px`);
    content.style.setProperty("--preview-w", `${s.previewWidth}px`);
  }
  if (sidebar) {
    if (s.sidebarHidden) sidebar.setAttribute("hidden", "");
    else sidebar.removeAttribute("hidden");
  }
}

export function initPanelSplitters(): void {
  const content = document.getElementById("content");
  const sidebarHandle = document.getElementById("sidebar-handle");
  const previewHandle = document.getElementById("preview-handle");
  if (!content || !sidebarHandle || !previewHandle) return;

  const reset = (which: "sidebar" | "preview") => {
    const s = getUiLayout();
    if (which === "sidebar") s.sidebarWidth = DEFAULT_UI_LAYOUT.sidebarWidth;
    else s.previewWidth = DEFAULT_UI_LAYOUT.previewWidth;
    applyUiLayout(s);
    saveUiLayout(s);
  };

  const wire = (
    handle: HTMLElement,
    onMove: (e: PointerEvent) => void,
    resetSelf: () => void,
  ) => {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add("pane-resizing");
      const move = (ev: PointerEvent) => onMove(ev);
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        document.body.classList.remove("pane-resizing");
        saveUiLayout(getUiLayout());
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", resetSelf);
  };

  wire(
    sidebarHandle,
    (e) => {
      const left = content.getBoundingClientRect().left;
      const s = getUiLayout();
      s.sidebarWidth = clampPaneWidth(e.clientX - left, SIDEBAR_MIN, SIDEBAR_MAX);
      s.sidebarHidden = false;
      applyUiLayout(s);
    },
    () => reset("sidebar"),
  );

  wire(
    previewHandle,
    (e) => {
      const rect = content.getBoundingClientRect();
      const s = getUiLayout();
      const b = previewBounds(rect.width, s.sidebarWidth, s.sidebarHidden);
      s.previewWidth = clampPaneWidth(rect.right - e.clientX, b.min, b.max);
      applyUiLayout(s);
    },
    () => reset("preview"),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/uilayout.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Full suite + commit**

Run: `npm test`
Expected: PASS, no regressions.

```bash
git add src/uilayout.ts src/__tests__/uilayout.test.ts
git commit -m "feat(ui): panel layout state module with splitters"
```

---

### Task 2: Handle markup + CSS

**Files:**
- Modify: `index.html` (inside `<main id="content">`, ~line 11-17)
- Modify: `src/styles.css` (sidebar block ~286-293, preview block ~62-68)

**Depends:** none

**Interfaces:**
- Consumes: nothing (markup/CSS only; the ids `sidebar-handle` / `preview-handle` and CSS vars `--sidebar-w` / `--preview-w` / class `pane-resizing` are the contract consumed by Task 1's `initPanelSplitters` and Task 3).
- Produces: DOM handles `#sidebar-handle` (between `#sidebar` and `#editor`) and `#preview-handle` (between `#editor` and `#preview`).

- [ ] **Step 1: Add handle divs to `index.html`**

Current:

```html
<main id="content">
  <aside id="sidebar" hidden>
    <div id="sidebar-title"></div>
    <div id="tree"></div>
  </aside>
  <div id="editor"></div>
  <div id="preview" hidden></div>
</main>
```

Change to (handles are siblings between the panes, in this exact order):

```html
<main id="content">
  <aside id="sidebar" hidden>
    <div id="sidebar-title"></div>
    <div id="tree"></div>
  </aside>
  <div class="pane-handle" id="sidebar-handle"></div>
  <div id="editor"></div>
  <div class="pane-handle" id="preview-handle"></div>
  <div id="preview" hidden></div>
</main>
```

- [ ] **Step 2: Update `src/styles.css`**

In the `#sidebar` rule (~line 286), replace the fixed width:

```css
#sidebar {
  flex: none;
  width: var(--sidebar-w, 220px);
  min-width: 140px;
  max-width: 480px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 4px 0;
}
```

In the `#preview` rule (~line 62), replace `flex: 1` with an anchored width:

```css
#preview {
  flex: none;
  width: var(--preview-w, 380px);
  min-width: 200px;
  overflow: auto;
  border-left: 1px solid var(--border);
  padding: 0 16px;
}
#preview[hidden] { display: none; }
```

Add (near the sidebar block):

```css
.pane-handle {
  flex: none;
  width: 5px;
  cursor: col-resize;
  background: transparent;
}
.pane-handle:hover, .pane-handle:active { background: var(--border); }
body.pane-resizing { cursor: col-resize; user-select: none; }
#sidebar[hidden] + #sidebar-handle { display: none; }
#preview-handle:has(+ #preview[hidden]) { display: none; }
```

(`#editor` keeps `flex: 1; min-width: 0;` and absorbs all free space - no change.)

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS (no TS touched; tree tests render their own `<aside id="sidebar">` fixtures and are unaffected by CSS).

Run: `npm run build`
Expected: builds clean.

- [ ] **Step 4: Commit**

```bash
git add index.html src/styles.css
git commit -m "feat(ui): pane handle markup and column width CSS"
```

---

### Task 3: Menu toggle + startup wiring

**Files:**
- Modify: `src/menu.ts` (actions interface ~9-31, handles ~33-36, View submenu ~104-116)
- Modify: `src/main.ts` (workspace restore ~542, actions impl ~417-460, imports)

**Depends:** Task 1, Task 2

**Interfaces:**
- Consumes (from Task 1): `loadUiLayout`, `applyUiLayout`, `getUiLayout`, `saveUiLayout`, `initPanelSplitters`, `type UiLayout` - exact signatures in Task 1 Produces.
- Consumes (from Task 2): `#sidebar-handle` / `#preview-handle` elements present in `index.html`.
- Produces: View menu item id `"toggleSidebar"`; `MenuActions.toggleSidebar(on: boolean): void`; `MenuHandles.sidebarItem: CheckMenuItem`.

- [ ] **Step 1: Extend `src/menu.ts`**

Add to the `MenuActions` interface (alongside `togglePreview`):

```ts
toggleSidebar: (on: boolean) => void;
```

Add `sidebarItem: CheckMenuItem` to the `MenuHandles` interface and its return object.

Create the item next to `previewItem` (~line 85), modeled on it:

```ts
const sidebarItem = await CheckMenuItem.new({
  id: "toggleSidebar",
  text: "Toggle Sidebar",
  checked: true,
  action: async () => {
    actions.toggleSidebar(await sidebarItem.isChecked());
  },
});
```

Insert into the View submenu items list (the current array ends `..., themeItem, previewItem`):

```ts
themeItem,
sidebarItem,
previewItem,
```

(No separator - matches existing adjacent items; repo pattern is `await PredefinedMenuItem.new({ item: "Separator" })` inline, not a spread.)

Add `sidebarItem` to the returned `MenuHandles` object.

- [ ] **Step 2: Wire actions + startup in `src/main.ts`**

Add imports:

```ts
import { applyUiLayout, getUiLayout, initPanelSplitters, loadUiLayout, saveUiLayout } from "./uilayout";
```

Add to the `MenuActions` implementation object (next to `togglePreview`, ~line 437):

```ts
toggleSidebar: (on) => {
  const s = getUiLayout();
  s.sidebarHidden = !on;
  saveUiLayout(s);
  applyUiLayout(s);
},
```

In the startup restore path (~line 542): find the workspace-restore block (guarded by whether a stored workspace root exists; its success branch calls `document.getElementById("sidebar")?.removeAttribute("hidden")`). Remove that force-show line, and AFTER the whole guarded block (so it runs even with no saved workspace or a deleted root - otherwise handles are never wired), add unconditionally:

```ts
const ui = loadUiLayout();
applyUiLayout({ ...ui, sidebarHidden: !workspaceRoot ? true : ui.sidebarHidden });
initPanelSplitters();
menuHandles?.sidebarItem.setChecked(!getUiLayout().sidebarHidden);
```

(`workspaceRoot` is the module variable set by the restore block; no workspace → sidebar starts hidden regardless of saved state, matching the current markup default. `menuHandles?.` matches the existing optional-chaining pattern used for `previewItem` in `applyPreviewMode`.)

Also sync the check state where a folder is opened: in the `openFolder` action (~line 85, where the `hidden` attribute is removed) add:

```ts
menuHandles?.sidebarItem.setChecked(true);
const s = getUiLayout();
s.sidebarHidden = false;
applyUiLayout(s);
```

(No save here - `saveUiLayout` happens on drag end/toggle/reset; showing via folder open is ephemeral until next persist, matching preview behavior.)

And in `closeFolder` (~line 94, where `hidden` is set on the sidebar) add one line so the menu check state stays truthful:

```ts
menuHandles?.sidebarItem.setChecked(false);
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: builds clean.

Manual smoke (if display available): `npm run tauri dev` - drag both handles, dblclick resets, View > Toggle Sidebar hides/shows tree, widths + hidden state survive restart, tree expansion state survives collapse/re-expand.

- [ ] **Step 4: Commit**

```bash
git add src/menu.ts src/main.ts
git commit -m "feat(ui): toggle sidebar menu item, splitter wiring, layout persistence"
```

---

## Close-out (documenter, after tasks)

- `CHANGELOG.md`: `[Unreleased]` → Added: resizable sidebar and preview columns with drag handles; collapsible sidebar via View > Toggle Sidebar; layout persisted across restarts.
- `README.md`: mention resizable/collapsible panels in UI section if it describes panes.
- Version bump: minor → `0.8.0` in `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml` (canonical source + sync targets per AGENTS.md).
- Component table in AGENTS.md: no new area (uilayout.ts belongs under Frontend) - no change needed.
