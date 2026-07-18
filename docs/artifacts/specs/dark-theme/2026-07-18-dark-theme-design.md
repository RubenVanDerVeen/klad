# Dark Theme Toggle — Design Spec

- **Date:** 2026-07-18
- **Topic:** `dark-theme`
- **Status:** Approved (brainstormed 2026-07-18)
- **Owner:** ruben
- **Implementation plan:** `docs/artifacts/plans/dark-theme/2026-07-18-dark-theme-plan.md` (to be written)

## 1. Summary

Add a light/dark theme toggle to Klad. Binary state, surfaced as a checkbox in the native **View** menu (mirroring the existing **Markdown Preview** item), persisted in `localStorage` alongside the other frontend settings. Dark palette is One Dark-inspired.

**No new dependencies.** No backend changes. No `index.html` markup changes. No CodeMirror extension machinery.

## 2. Goals & non-goals

### Goals
- User can switch between light and dark theme via **View → Dark Theme** (accelerator `CmdOrCtrl+Shift+L`).
- Choice persists across launches and is reflected in the checkbox state on load.
- Dark mode covers every visible surface: editor (CodeMirror chrome), tab bar, status bar, preview pane (headings, code blocks, blockquotes, tables), and all dialogs (`savePrompt`, `errorBox`, `fontDialog`).
- Light mode is preserved exactly as today — no visual regressions.

### Non-goals (YAGNI)
- No `"system"` / OS-following mode. (Binary `light | dark` only. Settings shape allows adding `"system"` later without a migration.)
- No status-bar theme indicator.
- No accent-color picker or theme variants.
- No CodeMirror `EditorView.theme()` extension or `@codemirror/theme-one-dark` dependency. There is no syntax highlighting in the editor today (no `@codemirror/lang-*`), so CM theming is just chrome — handled by CSS overrides.
- No per-token syntax colors.

## 3. Approach chosen

**Approach A — CSS variables + `data-theme` attribute on `<html>`.**

Design tokens live in `styles.css` as CSS custom properties. A single `data-theme` attribute on `document.documentElement` selects light (default) or dark (overridden) values. `applyTheme()` in `main.ts` sets that one attribute; the CSS cascade does the rest, including for CodeMirror chrome (via `[data-theme="dark"] .cm-*` selectors that outrank CodeMirror's default stylesheet by specificity) and for the preview pane (which already inherits from `styles.css`).

### Rejected alternatives
- **B. CSS variables + CodeMirror `EditorView.theme()` extension via Compartment.** Two parallel theming systems. The Compartment swap pattern is already in use for `wrap`, but CM's extension only buys chrome styling that CSS already handles. Reach for this only if/when syntax highlighting is added.
- **C. Set color CSS variables imperatively in TS** (like `applyEditorStyle` does for fonts). Puts design tokens in the wrong file (TS instead of CSS), loses cascade benefits.

## 4. Architecture & data flow

Two independent initialization paths from `loadSettings()`, plus the user-click path:

```
loadSettings() ──┬──> applyTheme() ──> <html data-theme="…"> ──> CSS cascade restyles everything
                 │
                 └──> setupMenu(actions, settings.wrap, settings.theme === "dark")
                                              │
                                              └──> themeItem constructed with `checked: <initial>`
                                                   (same pattern as wrapItem — no post-construction setChecked)

User clicks View → Dark Theme ──> action: toggleTheme(await themeItem.isChecked())
   ├── settings.theme = on ? "dark" : "light"
   ├── saveSettings(settings)
   └── applyTheme()
```

- **Default at first run:** `"light"` (no surprise, matches current behavior).
- **Persisted choice** is restored on launch via two paths: the `data-theme` attribute (driven by `applyTheme`) and the menu checkbox (driven by the `initialThemeDark` arg to `setupMenu`, mirroring how `wrapItem` already works at `menu.ts:38,75`).
- The menu checkbox is auto-flipped by Tauri before the action fires — same `// ponytail: relies on Tauri flipping CheckMenuItem state before invoking the action` note as `previewItem`. The user-click path reads the new checked state via the closure; **no manual `setChecked` is ever needed** because there is no code path that flips the theme without going through the menu.

## 5. CSS variable contract

Nine semantic variables under `:root` (light = current values), overridden under `[data-theme="dark"]`. Every hardcoded hex literal in `styles.css` is replaced by exactly one of these.

| Variable | Light (current) | Dark (One Dark-ish) | Used by |
|---|---|---|---|
| `--bg` | `#ffffff` | `#282c34` | page bg, editor surface |
| `--panel-bg` | `#f5f5f5` | `#21252b` | tab bar, statusbar, `.cm-panels` (search), preview `pre` |
| `--fg` | `#000000` | `#abb2bf` | primary text, active tab label, editor text |
| `--fg-muted` | `#555555` | `#5c6370` | blockquote text, statusbar text, inactive tab label |
| `--border` | `#d0d0d0` | `#3e4451` | every existing border (preview, statusbar, tabs, dialogs) |
| `--accent` | `#0078d4` | `#528bff` | active-tab stripe, dirty dot, editor cursor |
| `--hover-bg` | `#eaeaea` | `#2c313a` | tab hover, tab-close hover |
| `--code-bg` | `#f0f0f0` | `#2c313a` | preview inline `code` |
| `--heading-border` | `#e0e0e0` | `#3e4451` | preview `h1`/`h2` underline |

**Notes:**
- The standalone dialog border `#bbb` collapses into `--border` (small visual shift; preferable to a 10th variable).
- Existing `--editor-font-family` and `--editor-font-size` (set imperatively by `applyEditorStyle`) are untouched.
- No new selectors in light mode — every existing rule keeps its selector, only the value changes from literal to `var(--…)`.

### CodeMirror-specific overrides (dark only)

Six rules, all scoped under `[data-theme="dark"]`, all reading from the same 9 vars:

```css
[data-theme="dark"] .cm-editor           { background-color: var(--bg); color: var(--fg); }
[data-theme="dark"] .cm-gutters          { background-color: var(--panel-bg); border-right: 1px solid var(--border); color: var(--fg-muted); }
[data-theme="dark"] .cm-content           { color: var(--fg); }
[data-theme="dark"] .cm-cursor           { border-left-color: var(--accent); }
[data-theme="dark"] .cm-selectionBackground,
[data-theme="dark"] .cm-content ::selection { background-color: var(--hover-bg); }
[data-theme="dark"] .cm-panels           { background-color: var(--panel-bg); color: var(--fg); border-top: 1px solid var(--border); }
```

These outrank CodeMirror's built-in stylesheet by selector specificity (`[data-theme="dark"] .cm-editor` > `.cm-editor`). The existing `.cm-panels` rule in `styles.css:64` is the precedent.

## 6. Code touchpoints

Five files changed, no new files.

### `src/settings.ts`
- Add `theme: "light" | "dark"` to the `Settings` interface and to `DEFAULT_SETTINGS` (default `"light"`).
- In `parseSettings`, add a `typeof obj.theme === "string" && (obj.theme === "light" || obj.theme === "dark")` branch; on any other value, fall through to `DEFAULT_SETTINGS.theme`.

### `src/menu.ts`
- Add `toggleTheme(on: boolean): void` to the `MenuActions` interface (after `togglePreview`).
- Add a third positional arg `initialThemeDark: boolean` to `setupMenu`'s signature, alongside the existing `initialWrap: boolean`.
- Construct `themeItem` modeled on `wrapItem` (which already takes its initial checked state from an arg), placed adjacent to `previewItem`:
  ```ts
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
- Insert `themeItem` into the **View** menu items, immediately before `previewItem`.
- **Do NOT add `themeItem` to `MenuHandles`.** No consumer needs it: initial state is set at construction time via `initialThemeDark`, and the user-click path auto-syncs via Tauri. (Ponytail: `wrapItem` is currently in `MenuHandles` but unused from `main.ts` — we don't extend that smell.)

### `src/main.ts`
- Add `applyTheme()` as a sibling of `applyEditorStyle()` (line 69):
  ```ts
  function applyTheme(): void {
    document.documentElement.dataset.theme = settings.theme;
  }
  ```
- Call `applyTheme()` once at module load, immediately after the existing `applyEditorStyle()` call.
- Wire `toggleTheme` in the `setupMenu({...})` action object (lines 351-389), modeled on `togglePreview` (lines 371-374):
  ```ts
  toggleTheme: (on) => {
    settings.theme = on ? "dark" : "light";
    saveSettings(settings);
    applyTheme();
  },
  ```
- Pass `settings.theme === "dark"` as the new third positional arg to `setupMenu(...)` (currently the call ends at line 388-389 with `settings.wrap`). Final call shape:
  ```ts
  menuHandles = await setupMenu({ ...actions }, settings.wrap, settings.theme === "dark");
  ```

### `src/styles.css`
- Add `:root { --bg: …; --panel-bg: …; … }` block at the top with the 9 light values.
- Add `[data-theme="dark"] { --bg: …; … }` block with the 9 dark overrides.
- Replace every hardcoded hex literal with the matching `var(--…)`.
- Append the 6 CodeMirror dark-mode override rules.

### `src/__tests__/settings.test.ts`
- Add cases:
  - `DEFAULT_SETTINGS.theme === "light"`.
  - `parseSettings({ theme: "dark", …valid fields })` returns `theme: "dark"`.
  - `parseSettings({ theme: "purple", … })` falls back to `"light"`.
  - `parseSettings({ theme: 123, … })` (wrong type) falls back to `"light"`.
  - Round-trip: `parseSettings(saveSettings(snapshot))` preserves `"dark"`.

## 7. Catalogs that must agree (AGENTS.md red flags)

| Catalog | Affected? |
|---|---|
| `src-tauri/src/main.rs` `invoke_handler![...]` | **No** — theme is frontend-only, no new Tauri command. |
| `src/fileio.ts` | **No** — no new `invoke()` wrapper. |
| `src-tauri/tauri.conf.json` `bundle.fileAssociations` | **No**. |
| `src-tauri/capabilities/default.json` | **No** — no new permission. |
| `package.json` / `src-tauri/Cargo.toml` deps | **No** — zero new dependencies. |
| `index.html` dialog markup | **No** — `data-theme` set imperatively from JS. |

## 8. Testing strategy

### Automated (vitest)
Extend `src/__tests__/settings.test.ts` per Section 6. Covers the settings-shape contract that's most likely to silently break (parser accepting bad values, defaults drifting).

Run: `npm run test`.

### Manual visual checklist (no framework — ponytail-style)
Toggle to dark, then verify each surface:

- [ ] Editor surface: background, text, cursor color, gutter.
- [ ] Tab bar: inactive tab text, active tab stripe + label, hover background, close-button hover.
- [ ] Status bar: text color, dropdown chevrons legible.
- [ ] Preview pane: body text, `h1`/`h2` underline, inline `code` background, `pre` block background, `blockquote` text, table borders.
- [ ] Search panel (`Ctrl+F`): background, text, input field.
- [ ] Dialogs: open Save Prompt (`<dialog id="savePrompt">`), Error (`<dialog id="errorBox">`), Font (`<dialog id="fontDialog">`) — verify backgrounds, borders, text.

Then toggle back to light and verify no stray dark artifacts remain on any surface. Then reload the window (`Ctrl+R` / `CmdOrCtrl+R`) and verify the persisted theme is restored and the View-menu checkbox matches.

### Backend tests
`cargo test` is unaffected — no Rust changes. Skipping it for this work is correct; the AGENTS.md "run both" rule applies when both halves change.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| CodeMirror's default light styles win over our `[data-theme="dark"]` overrides. | Override rules use `[data-theme="dark"] .cm-editor` (specificity 0,2,0) which outranks CM's default `.cm-editor` (0,1,0). Verified by the manual visual checklist item for editor surface. |
| A hex literal is missed during the styles.css refactor and stays light in dark mode. | The manual checklist walks every surface; also grep `styles.css` for any remaining `#[0-9a-fA-F]{3,6}` after refactor. |
| `parseSettings` accepts a `theme` value that is a valid string but not `"light"`/`"dark"` (e.g. `"purple"`), causing `[data-theme="purple"]` to match neither block → unstyled page. | Parser strictly narrows to the two allowed values; anything else falls back to `DEFAULT_SETTINGS.theme`. Covered by automated test. |
| Menu checkbox and `data-theme` attribute drift out of sync. | Cannot happen in this design. Both are set from the same source (`settings.theme`) at startup — checkbox via the `initialThemeDark` arg to `setupMenu`, attribute via `applyTheme()`. The user-click path is the only mutation point and updates `settings.theme` first, then both dependents. |

## 10. Out-of-scope follow-ups (not built now)

- `"system"` mode tracking `prefers-color-scheme` via `matchMedia`. The settings shape is forward-compatible (`theme: string`), so adding a third value is a non-breaking extension later.
- Status-bar theme indicator (third dropdown next to encoding/EOL).
- `@codemirror/theme-one-dark` / `EditorView.theme()` extension, only if/when syntax highlighting is added.
- Per-document theme override.
