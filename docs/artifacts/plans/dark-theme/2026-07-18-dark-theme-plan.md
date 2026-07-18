# Dark Theme Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a light/dark theme toggle to Klad, surfaced as a checkbox in the native View menu, persisted in `localStorage`, with an One Dark-inspired dark palette covering every visible surface.

**Architecture:** CSS custom properties under `:root` (light) overridden by `[data-theme="dark"]`. `applyTheme()` sets one attribute on `<html>`; the cascade restyles everything including CodeMirror chrome and the markdown preview. No new dependencies, no backend changes.

**Tech Stack:** Vanilla TypeScript, Vite 6, vitest, CodeMirror 6, Tauri 2 menu API.

**Spec:** `docs/artifacts/specs/dark-theme/2026-07-18-dark-theme-design.md` (read this first — every decision is justified there).

## Global Constraints

- **No new dependencies.** Zero additions to `package.json` or `src-tauri/Cargo.toml`.
- **No backend changes.** `src-tauri/**` is untouched. `cargo test` is not run for this work.
- **No `index.html` changes.** The `data-theme` attribute is set imperatively from JS on `document.documentElement`.
- **No new Tauri commands, no new capabilities, no new `invoke()` wrappers.** Theme is frontend-only.
- **Editor buffer LF-normalization, encoding-label contract, preview auto-toggle, no-web-framework** rules from `AGENTS.md` all still apply — nothing in this plan touches them.
- **Encoding of the theme value across the system:** the literal strings `"light"` and `"dark"` flow `settings.ts` → `localStorage` JSON → `main.ts` → `document.documentElement.dataset.theme` → CSS `[data-theme="..."]` selector. Changing the casing/spelling of either string breaks the cascade. Treat them as a contract.
- **Commit messages:** Conventional Commits 1.0.0 with scope = module (`feat(settings)`, `feat(styles)`, `feat(menu)`). One logical change per commit.
- **Branch:** cut `feat/dark-theme` from latest `main` before starting Task 1. Each task ends with one commit on this branch.
- **Run frontend tests after every code change:** `npm run test` (vitest). Run `npm run build` (`tsc && vite build`) before the final commit to catch cross-file type errors.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/settings.ts` | Add `theme: "light" \| "dark"` to `Settings`, default `"light"`, strict parser. | 1 |
| `src/__tests__/settings.test.ts` | Unit tests for the new `theme` field. | 1 |
| `src/styles.css` | Lift hex literals into 9 CSS variables; add `[data-theme="dark"]` overrides + 6 CodeMirror dark-mode rules. | 2 |
| `src/menu.ts` | Add `toggleTheme` to `MenuActions`, add `initialThemeDark` arg, construct `themeItem`, insert into View menu. | 3 |
| `src/main.ts` | Add `applyTheme()` sibling, call at startup, wire `toggleTheme` action, pass `initialThemeDark` to `setupMenu`. | 3 |

Three tasks, three commits. Each task ends with a green test suite (`npm run test`) and a successful `npm run build`.

---

## Task 1: Settings — add `theme` field (TDD)

**Files:**
- Modify: `src/settings.ts` (lines 1-13 for interface/defaults, lines 25-40 for parser)
- Modify: `src/__tests__/settings.test.ts` (append new test cases)

**Interfaces:**
- Produces: `Settings.theme: "light" | "dark"` — consumed by Task 3 (`main.ts` reads `settings.theme`, `menu.ts` receives `settings.theme === "dark"` as `initialThemeDark`).

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/settings.test.ts` (after the existing `clampZoom` test, before the closing `});`):

```typescript
  it("defaults theme to light", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("light");
    expect(parseSettings(null).theme).toBe("light");
  });

  it("accepts theme: 'dark'", () => {
    expect(parseSettings('{"theme":"dark"}').theme).toBe("dark");
  });

  it("rejects unknown theme strings", () => {
    expect(parseSettings('{"theme":"purple"}').theme).toBe("light");
    expect(parseSettings('{"theme":""}').theme).toBe("light");
  });

  it("rejects wrong-typed theme values", () => {
    expect(parseSettings('{"theme":123}').theme).toBe("light");
    expect(parseSettings('{"theme":null}').theme).toBe("light");
    expect(parseSettings('{"theme":true}').theme).toBe("light");
  });

  it("preserves theme through round-trip save→load", () => {
    const dark = { ...DEFAULT_SETTINGS, theme: "dark" as const };
    const roundTrip = parseSettings(JSON.stringify(dark));
    expect(roundTrip.theme).toBe("dark");
    expect(roundTrip).toEqual(dark);
  });
```

Also update the existing `null/corrupt/partial input falls back to defaults` test if needed — it should still pass unchanged because `DEFAULT_SETTINGS` will include `theme: "light"` and `parseSettings('{"zoom":150}')` will produce `{ ...DEFAULT_SETTINGS, zoom: 150 }` (theme defaults to "light"). No edit required to that test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/settings.test.ts`
Expected: 5 new tests FAIL. The 5 failures will look like `Property 'theme' does not exist on type 'Settings'` (TypeScript compile error inside vitest) or `expected undefined to be "light"`.

- [ ] **Step 3: Add the `theme` field to the `Settings` interface and defaults**

In `src/settings.ts`, edit lines 1-13 to:

```typescript
export interface Settings {
  wrap: boolean;
  zoom: number;
  fontFamily: string;
  fontSize: number;
  theme: "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  wrap: true,
  zoom: 100,
  fontFamily: "Consolas",
  fontSize: 14,
  theme: "light",
};
```

- [ ] **Step 4: Add the parser branch**

In `src/settings.ts`, add a line inside `parseSettings` immediately after the `fontSize` branch (after current line 38, before `return out;`). The full updated parser tail:

```typescript
  if (typeof obj.fontFamily === "string") out.fontFamily = obj.fontFamily;
  if (typeof obj.fontSize === "number") out.fontSize = clampFontSize(obj.fontSize);
  if (obj.theme === "light" || obj.theme === "dark") out.theme = obj.theme;
  return out;
```

The strict `=== "light" || === "dark"` check rejects every wrong type automatically (no `typeof` guard needed — `obj.theme === "light"` is false for numbers, null, undefined, booleans, and any other string).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/settings.test.ts`
Expected: all 9 tests PASS (4 pre-existing + 5 new).

- [ ] **Step 6: Run the full frontend test suite + type check**

Run: `npm run test`
Expected: all test files pass. (If any test fails and the failure is unrelated to the `theme` field, that is a pre-existing condition on `main` — note it and proceed. As of plan authoring, `npx tsc --noEmit` is clean and the suite is green.)

Run: `npm run build`
Expected: `tsc` exits 0, Vite build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/settings.ts src/__tests__/settings.test.ts
git commit -m "feat(settings): add theme preference (light|dark)"
```

---

## Task 2: Refactor `styles.css` to CSS variables + dark palette

**Files:**
- Modify: `src/styles.css` (add blocks at top; replace 26 hex literals across the file; append 6 CodeMirror overrides at bottom)

**Interfaces:**
- Consumes: none (pure CSS).
- Produces: the `[data-theme="dark"]` selector contract that Task 3's `applyTheme()` targets.

- [ ] **Step 1: Prepend the `:root` and `[data-theme="dark"]` blocks**

Insert at the very top of `src/styles.css` (before the existing `html, body {` rule on current line 1):

```css
:root {
  --bg: #ffffff;
  --panel-bg: #f5f5f5;
  --fg: #000000;
  --fg-muted: #555555;
  --border: #d0d0d0;
  --accent: #0078d4;
  --hover-bg: #eaeaea;
  --code-bg: #f0f0f0;
  --heading-border: #e0e0e0;
}

[data-theme="dark"] {
  --bg: #282c34;
  --panel-bg: #21252b;
  --fg: #abb2bf;
  --fg-muted: #5c6370;
  --border: #3e4451;
  --accent: #528bff;
  --hover-bg: #2c313a;
  --code-bg: #2c313a;
  --heading-border: #3e4451;
}
```

- [ ] **Step 2: Replace every hardcoded hex literal with the matching variable**

Apply the following edits (each is one `edit` call — match on the line content shown):

| Line(s) | Old | New |
|---|---|---|
| 35 | `border-left: 1px solid #d0d0d0;` | `border-left: 1px solid var(--border);` |
| 43 | `border-top: 1px solid #d0d0d0;` | `border-top: 1px solid var(--border);` |
| 45 | `color: #444;` (inside `#statusbar`) | `color: var(--fg-muted);` |
| 49 | `border: 1px solid #bbb;` | `border: 1px solid var(--border);` |
| 65 | `border-bottom: 1px solid #d0d0d0;` (`.cm-panels`) | `border-bottom: 1px solid var(--border);` |
| 66 | `background: #f5f5f5;` (`.cm-panels`) | `background: var(--panel-bg);` |
| 81 | `color: #444;` (`#statusbar select`) | `color: var(--fg-muted);` |
| 89 | `border-bottom: 1px solid #e0e0e0;` (`#preview h1/h2`) | `border-bottom: 1px solid var(--heading-border);` |
| 93 | `background: #f0f0f0;` (`#preview code`) | `background: var(--code-bg);` |
| 100 | `background: #f6f6f6;` (`#preview pre`) | `background: var(--panel-bg);` |
| 114 | `border: 1px solid #d0d0d0;` (`#preview th, td`) | `border: 1px solid var(--border);` |
| 118 | `border-left: 4px solid #d0d0d0;` (`#preview blockquote`) | `border-left: 4px solid var(--border);` |
| 121 | `color: #555;` (`#preview blockquote`) | `color: var(--fg-muted);` |
| 132 | `border-bottom: 1px solid #d0d0d0;` (`#tabbar`) | `border-bottom: 1px solid var(--border);` |
| 133 | `background: #f5f5f5;` (`#tabbar`) | `background: var(--panel-bg);` |
| 144 | `border-right: 1px solid #e8e8e8;` (`.tab`) | `border-right: 1px solid var(--border);` |
| 148 | `.tab:hover { background: #eaeaea; }` | `.tab:hover { background: var(--hover-bg); }` |
| 150 | `background: #fff;` (`.tab.active`) | `background: var(--bg);` |
| 151 | `box-shadow: inset 0 2px 0 #0078d4;` | `box-shadow: inset 0 2px 0 var(--accent);` |
| 153 | `.tab-label { color: #444; }` | `.tab-label { color: var(--fg-muted); }` |
| 154 | `.tab.active .tab-label { color: #000; }` | `.tab.active .tab-label { color: var(--fg); }` |
| 159 | `background: #0078d4;` (`.tab-dot`) | `background: var(--accent);` |
| 167 | `color: #666;` (`.tab-close`) | `color: var(--fg-muted);` |
| 173 | `.tab-close:hover { background: #d0d0d0; color: #000; }` | `.tab-close:hover { background: var(--border); color: var(--fg); }` |
| 180 | `color: #444;` (`#new-tab`) | `color: var(--fg-muted);` |
| 184 | `#new-tab:hover { background: #e0e0e0; }` | `#new-tab:hover { background: var(--hover-bg); }` |

Line 51's `box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);` is left as-is — it is a dialog drop-shadow, invisible on a dark backdrop (the dialog itself sits on the dark page), harmless in both modes. No variable needed.

Lines 28-29 already use `var(--editor-font-family, …)` / `var(--editor-font-size, …)` — leave untouched.

- [ ] **Step 3: Append the 6 CodeMirror dark-mode overrides**

Append at the very end of `src/styles.css`:

```css

/* CodeMirror dark-mode overrides (scoped by specificity > CM defaults) */
[data-theme="dark"] .cm-editor { background-color: var(--bg); color: var(--fg); }
[data-theme="dark"] .cm-gutters { background-color: var(--panel-bg); border-right: 1px solid var(--border); color: var(--fg-muted); }
[data-theme="dark"] .cm-content { color: var(--fg); }
[data-theme="dark"] .cm-cursor { border-left-color: var(--accent); }
[data-theme="dark"] .cm-selectionBackground,
[data-theme="dark"] .cm-content ::selection { background-color: var(--hover-bg); }
```

Note on specificity: each rule is `[data-theme="dark"] .cm-*` — the attribute selector counts as a class for specificity, giving 0,2,0. CodeMirror's built-in stylesheet uses bare `.cm-editor` / `.cm-gutters` / etc. (0,1,0), so our scoped rules win. The existing `#editor .cm-editor { height: 100%; }` rule at line 21 doesn't set background or color, so it doesn't fight us on those properties — no need for an `#editor` prefix.

Note on `.cm-activeLine`: deliberately omitted. The `highlightActiveLine()` extension is not loaded (see `src/editor.ts`), so `.cm-activeLine` never appears in the DOM — a rule for it would be dead CSS.

- [ ] **Step 4: Verify no hex literals remain outside the variable blocks**

Run: `rg "#[0-9a-fA-F]{3,8}" src/styles.css`
Expected: 18 matches, ALL inside the `:root { … }` and `[data-theme="dark"] { … }` blocks at the top (lines 1-22 after the insert). The `rgba(0, 0, 0, 0.2)` on the dialog shadow is not matched by this regex. If any hex literal appears below line 22, fix it before continuing.

- [ ] **Step 5: Manually verify both themes render correctly**

Run: `npm run tauri dev`

Once the app window opens, open DevTools (Tauri dev allows this; if not enabled, right-click → Inspect Element, or use the `Toggle DevTools` menu item if present). In the Console, run:

```js
document.documentElement.dataset.theme = "dark"
```

Expected: the entire UI flips to dark — editor surface, tab bar, status bar, and (if you open a `.md` file or paste markdown into a new file) the preview pane. Run:

```js
document.documentElement.dataset.theme = "light"
```

Expected: everything flips back to light with no stray dark artifacts. If any surface doesn't change, re-check Step 2 — a hex literal was missed.

Close the dev session (`Ctrl+C` in the terminal).

- [ ] **Step 6: Run type check + build**

Run: `npm run build`
Expected: `tsc` exits 0, Vite build succeeds (CSS changes don't affect TS, but the build catches accidental syntax errors).

- [ ] **Step 7: Commit**

```bash
git add src/styles.css
git commit -m "feat(styles): theme-aware CSS variables with dark palette"
```

---

## Task 3: Menu + main.ts — add the Dark Theme item and wire it up

**Files:**
- Modify: `src/menu.ts` (lines 9-28 `MenuActions`, line 35-38 `setupMenu` signature, after line 86 construct `themeItem`, lines 88-99 `viewMenu`)
- Modify: `src/main.ts` (after line 69 add `applyTheme()` + call, line 374 wire `toggleTheme`, lines 388-389 add third arg to `setupMenu`)

**Interfaces:**
- Consumes from Task 1: `Settings.theme: "light" | "dark"`, `saveSettings()`.
- Consumes from Task 2: `[data-theme="dark"]` selector (driven by `applyTheme()`).
- Produces: the user-visible toggle. End-to-end working feature.

> **Why one commit for both files:** Task 2 of `src/menu.ts` changes the `setupMenu` signature (adds a required positional arg) and adds a required member to `MenuActions`. `src/main.ts` is the only caller and must supply both. Splitting would leave a known-broken intermediate commit where `tsc` fails. Menu + wiring are one cohesive change.

- [ ] **Step 1: Add `toggleTheme` to `MenuActions`**

In `src/menu.ts`, edit the `MenuActions` interface (lines 9-28). Insert `toggleTheme` immediately after `togglePreview`:

```typescript
export interface MenuActions {
  newFile(): void;
  openFile(): void;
  saveFile(): void;
  saveFileAs(): void;
  print(): void;
  exit(): void;
  find(): void;
  replace(): void;
  goToLine(): void;
  setWrap(on: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  chooseFont(): void;
  togglePreview(on: boolean): void;
  toggleTheme(on: boolean): void;
  closeTab(): void;
  nextTab(): void;
  prevTab(): void;
}
```

- [ ] **Step 2: Add the `initialThemeDark` parameter to `setupMenu`**

In `src/menu.ts`, edit the `setupMenu` signature (lines 35-38):

```typescript
export async function setupMenu(
  actions: MenuActions,
  initialWrap: boolean,
  initialThemeDark: boolean,
): Promise<MenuHandles> {
```

- [ ] **Step 3: Construct `themeItem`**

In `src/menu.ts`, immediately after the `previewItem` block (current lines 79-86), insert:

```typescript
  let themeItem: CheckMenuItem | undefined;
  themeItem = await CheckMenuItem.new({
    id: "themeDark",
    text: "Dark Theme",
    accelerator: "CmdOrCtrl+Shift+L",
    checked: initialThemeDark,
    // ponytail: relies on Tauri flipping CheckMenuItem state before invoking the action
    action: async () => actions.toggleTheme(await themeItem!.isChecked()),
  });
```

This mirrors the `wrapItem` pattern (lines 71-77) — initial state from an arg, not a post-construction `setChecked` call. We deliberately do **not** add `themeItem` to `MenuHandles`: no consumer needs it (the user-click path auto-syncs via Tauri).

- [ ] **Step 4: Insert `themeItem` into the View menu**

In `src/menu.ts`, edit the `viewMenu` items array (lines 88-99). Place `themeItem` immediately before `previewItem`, separated by the existing separator:

```typescript
  const viewMenu = await Submenu.new({
    text: "View",
    items: [
      wrapItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "zoomIn", text: "Zoom In", accelerator: "CmdOrCtrl+=", action: actions.zoomIn }),
      await MenuItem.new({ id: "zoomOut", text: "Zoom Out", accelerator: "CmdOrCtrl+-", action: actions.zoomOut }),
      await MenuItem.new({ id: "zoomReset", text: "Restore Default Zoom", accelerator: "CmdOrCtrl+0", action: actions.zoomReset }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      themeItem,
      previewItem,
    ],
  });
```

- [ ] **Step 5: Verify TypeScript compiles for `menu.ts` in isolation**

Run: `npx tsc --noEmit`
Expected: TypeScript reports errors only in `src/main.ts` (missing `toggleTheme` in the actions object passed to `setupMenu`, wrong number of args to `setupMenu`). This is expected — we fix it in the next steps. **No errors should reference `src/menu.ts`.**

- [ ] **Step 6: Add `applyTheme()` to `src/main.ts`**

In `src/main.ts`, immediately after the existing `applyEditorStyle()` function definition (around lines 69-74) and its call site, add:

```typescript
function applyTheme(): void {
  document.documentElement.dataset.theme = settings.theme;
}
applyEditorStyle();
applyTheme();
```

The exact placement: the existing code reads (lines 69-74):

```typescript
function applyEditorStyle(): void {
  const root = document.documentElement.style;
  root.setProperty("--editor-font-family", settings.fontFamily);
  root.setProperty("--editor-font-size", `${(settings.fontSize * settings.zoom) / 100}px`);
}
applyEditorStyle();
```

Insert `applyTheme` as a sibling function definition, and add the `applyTheme();` call immediately after the `applyEditorStyle();` call. Both run at module load.

- [ ] **Step 7: Wire the `toggleTheme` action**

In `src/main.ts`, inside the `setupMenu({...})` action object (lines 351-389), add `toggleTheme` immediately after `togglePreview`. The relevant block becomes:

```typescript
      togglePreview: (on) => {
        setPreviewVisible(on);
        if (on) renderPreviewNow(getText(activeTab().view));
      },
      toggleTheme: (on) => {
        settings.theme = on ? "dark" : "light";
        saveSettings(settings);
        applyTheme();
      },
```

- [ ] **Step 8: Pass `initialThemeDark` to `setupMenu`**

In `src/main.ts`, the `setupMenu(...)` call currently ends with `settings.wrap` as the only initial-state arg (lines 388-389):

```typescript
    },
    settings.wrap,
  );
```

Change to pass the new third arg:

```typescript
    },
    settings.wrap,
    settings.theme === "dark",
  );
```

- [ ] **Step 9: Verify TypeScript compiles cleanly**

Run: `npm run build`
Expected: `tsc` exits 0, Vite build succeeds. No errors.

- [ ] **Step 10: Run the test suite**

Run: `npm run test`
Expected: all tests pass (Task 1's settings tests still green; no regressions).

- [ ] **Step 11: Manual end-to-end visual checklist**

Run: `npm run tauri dev`

Walk this checklist (ponytail-style, no framework — verify each surface with your eyes):

- [ ] **View menu** shows "Dark Theme" item with `Ctrl+Shift+L` accelerator, unchecked at first run.
- [ ] Click **Dark Theme** → entire UI flips to dark: editor surface, tab bar, status bar.
- [ ] **Editor surface**: background `#282c34`, text `#abb2bf`, cursor `#528bff`, gutter dark.
- [ ] **Tab bar**: inactive tab text muted, active tab has `#528bff` top stripe + `#abb2bf` label, hover darkens the tab.
- [ ] **Status bar**: text legible, encoding/EOL/zoom dropdowns legible.
- [ ] **Search panel** (`Ctrl+F`): dark background, input field dark, text legible.
- [ ] **Preview pane** (open or paste a `.md` file with `# heading`, `` `code` ``, `> quote`, a table, and a code block): heading underline, inline code bg, pre block bg, blockquote text, table borders all dark-themed.
- [ ] **Dialogs**: trigger Save Prompt (close a dirty tab), Error (force an error if easy), Font (Format → Font). Each dialog: dark background, dark border, legible text.
- [ ] Click **Dark Theme** again → everything flips back to light with no stray dark artifacts.
- [ ] With dark active, reload the window (`Ctrl+R` or `CmdOrCtrl+R`) → dark theme persists on reload, **and the View → Dark Theme checkbox is still checked**.
- [ ] With light active, reload → light persists, checkbox unchecked.

- [ ] **Step 12: Commit**

```bash
git add src/menu.ts src/main.ts
git commit -m "feat(menu): add Dark Theme toggle to View menu"
```

---

## Final verification

After Task 3 commits, run once more:

- [ ] **`npm run test`** — all green.
- [ ] **`npm run build`** — `tsc` clean, Vite build succeeds.
- [ ] **`git log --oneline main..feat/dark-theme`** — shows exactly three commits matching the messages above.
- [ ] **Catalog check (AGENTS.md red flags):**
  - `src-tauri/src/main.rs` `invoke_handler![...]` — unchanged.
  - `src/fileio.ts` — unchanged.
  - `src-tauri/tauri.conf.json` `bundle.fileAssociations` — unchanged.
  - `src-tauri/capabilities/default.json` — unchanged.
  - `package.json` and `src-tauri/Cargo.toml` deps — unchanged.
  - `index.html` — unchanged.

If every checkbox above is green, the feature is complete. Merge `feat/dark-theme` to `main` per the project's normal flow (the user/ orchestrator decides when).
