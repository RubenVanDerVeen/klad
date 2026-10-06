# Design: Resizable & Collapsible Panels

Date: 2026-10-06
Status: approved (defaults chosen per planner pipeline; user request explicit)

## Problem

Sidebar (file tree) is a fixed 220px column with no way to shrink, grow, or hide it. When a Typst workspace is open but the user writes `.md` files, the tree still occupies space. The preview column cannot be resized either. User wants: resize columns for flexibility, collapse the tree when not needed.

## Current state (recon)

- Layout: `index.html:9-18` - `#content` flex row with `#sidebar` (fixed `width: 220px`, `flex: none`, styles.css:286-293), `#editor` (`flex: 1`), `#preview` (`flex: 1`, `hidden` when off).
- No resize/drag infra anywhere in `src/` (grep: zero hits).
- Sidebar shown/hidden only via folder open/close (`main.ts:85,94,542`) using the `hidden` attribute; tree DOM is preserved by `hidden`, so collapsing is non-destructive.
- Preview visibility is file-type-driven via `applyPreviewMode()` (`main.ts:237-247`) - reasserted on every tab event.
- Persistence precedent: `src/settings.ts` (`klad-settings` key, pure tolerant `parseSettings`, unit-tested) and `src/workspace.ts` (`klad-workspace`).
- Menu: View submenu at `menu.ts:104-116`; CheckMenuItem pattern at `menu.ts:85-92` (`previewItem`), handles via `MenuHandles`, actions interface `MenuActions` implemented in `main.ts:417-460`.

## Approaches considered

1. **CSS-only `resize: horizontal` on sidebar** - native, zero JS, but: preview has no width anchor so it cannot be resized this way; no persistence hook; poor discoverability; collapse still needs JS. Half a solution. Rejected.
2. **Drag-handle splitters + persistence (recommended)** - thin handle divs between the three panes, Pointer Events adjust pane widths, View menu item toggles sidebar, state persisted in localStorage. ~100 lines TS + ~30 lines CSS, no dependencies. Full flexibility, matches request.
3. **Split.js / split-pane library** - external dependency for what is ~100 lines of pointer-event code. Rejected (no new deps for a few lines).

## Design (approach 2)

### Components

**`src/uilayout.ts` (new)** - panel layout state + splitter logic. Pure-ish module in the style of `workspace.ts`:

- `KEY = "klad-ui"` → `{ sidebarWidth: number, previewWidth: number, sidebarHidden: boolean }`. Defaults: `220, 380, false`.
- `parseUiLayout(raw: unknown): UiLayout` - tolerant junk-rejecting/clamping parse (pure, exported for tests), same discipline as `parseSettings`.
- `loadUiLayout() / saveUiLayout()` - localStorage round-trip.
- `applyUiLayout(state)` - writes CSS custom properties on `#content` (`--sidebar-w`, `--preview-w`) and flips `hidden` on `#sidebar`.
- `initPanelSplitters(opts)` - creates/attaches the two handle behaviors: Pointer Events (pointerdown → setPointerCapture, pointermove → recompute width = clamped `clientX - contentLeft`, pointerup → save), double-click on a handle resets that side to its default. Sidebar drag grows/shrinks `--sidebar-w`; preview drag sets `--preview-w` = `contentRight - clientX`. Clamps: sidebar 140–480px, preview 200–(content width − 240) so editor never collapses.
- While dragging: `user-select: none` on body; cursor `col-resize` on handles.

**`index.html`** - two handle divs inside `#content`: `<div class="pane-handle" id="sidebar-handle">`, `<div class="pane-handle" id="preview-handle">` (siblings between the panes).

**`src/styles.css`** - `#sidebar { width: var(--sidebar-w, 220px); }`, `#preview { flex: none; width: var(--preview-w, 380px); }` (only when visible; `hidden` still removes it and editor keeps `flex: 1` to absorb free space). `.pane-handle { flex: none; width: 5px; cursor: col-resize; }` hover highlight via `--border`/accent. `#preview[hidden]` display:none safety rule.

**`src/menu.ts` + `src/main.ts`** - View > "Toggle Sidebar" CheckMenuItem (no accelerator; CodeMirror default keymaps own Ctrl-B etc.). Extends `MenuHandles` + `MenuActions` (`toggleSidebar(on)`), implemented in `main.ts`: apply `sidebarHidden`, persist, keep check state in sync. Startup path: after workspace restore, `loadUiLayout()` + `applyUiLayout()` + `initPanelSplitters()`. At startup, saved `sidebarHidden: true` wins over the current workspace-restore force-show (`main.ts:542`) - that block is replaced by the layout apply. An explicit user "Open Folder…" (`main.ts:85`) still shows the sidebar; that is expected feedback for a deliberate action.

### Behavior decisions

- Sidebar collapse keeps the `hidden` attribute convention - tree DOM, expansion state, and workspace root untouched; re-expand instant.
- Preview collapse stays as-is (file-type-driven auto show/hide). User's complaint was the tree; manual preview toggle is out of scope (would require reworking `applyPreviewMode`).
- Double-click a handle resets that pane's width to default (cheap discoverability).
- Window resize: no JS listener; `min-width` clamps on panes keep layout valid, widths re-clamp in memory only on next drag.

### Error handling

- Corrupt/missing `klad-ui` → defaults via tolerant parse (never throws).
- `localStorage` unavailable → in-memory fallback, same as existing settings code.

## Non-goals (YAGNI)

- Manual preview collapse/override of `applyPreviewMode`.
- Vertical resizing of tabbar/statusbar; per-filetype widths; size sync across windows; animations; keyboard resize handles.

## Testing

- `src/__tests__/uilayout.test.ts`: parse junk/clamps/defaults; localStorage round-trip; `applyUiLayout` sets CSS vars + hidden (jsdom); double-click reset calls save with default.
- Drag math exported as a pure `clampPaneWidth` helper and unit-tested (jsdom has no real layout, so the pure clamp is the testable core).
- Existing suites must stay green: `npm test`, `cd src-tauri && cargo test` (no Rust changes).

## Catalogs to update (close-out)

`README.md` (UI description), `CHANGELOG.md` (`[Unreleased]` Added/Changed). No Tauri command, capability, or dependency changes.

## Versioning

`feat` scope → **minor bump**: `0.7.2` → `0.8.0` (canonical source `src-tauri/tauri.conf.json`, synced to `package.json` + `src-tauri/Cargo.toml`), applied at close-out per policy.
