# Typst error bar: slim top bar instead of side panel

- Date: 2026-11-09
- Status: approved
- Trigger: user report, Typst compile errors render as a full-height pink column left of the file tree, eating most of the screen (screenshot 2026-11-09).

## Problem

`src/preview.ts` builds the error banner (`#preview-error`, `errorBannerEl()` at preview.ts:92-111) and prepends it to `pane().parentElement`, which is `#content`, a `display: flex` **row** (styles.css:40-44). The banner becomes the first flex child, sits left of `#sidebar`, and stretches full height: a giant column instead of a slim bar.

Additional gaps in the current banner:
- Only `result.errors[0]` is ever shown (`applyTypstResult`, preview.ts:129-136); the payload carries `Vec<TypstError>` but the count is discarded.
- Hardcoded light-theme colors (`#fde8e8`/`#b00`) with no dark-mode variant, unlike `.plot-error` (styles.css:199-212).
- `white-space: pre-wrap` lets long messages wrap into a block.

## Goal

Compile errors appear on a **slim, single-line bar pinned at the top of the preview pane**: first error message (same `file:line:` prefix as today), `+N` count badge when multiple errors, full text on hover (`title`), and a ✕ dismiss button. Auto-hides on successful compile, tab switch, or preview hide, as today.

## Carried constraints (from docs/artifacts/choices/)

- `2026-10-06-panel-resize-collapse`: panes are hand-rolled Pointer Events splitters (`src/uilayout.ts`); widths travel as CSS custom properties on `#content`. No new dependencies, no framework UI. The banner change must not disturb `#content` children or the splitter rules (`#preview-handle:has(+ #preview[hidden])`, styles.css:307).
- `2026-09-30-typst-dirty-buffer-overlay` / `2026-09-30-typst-active-tab-entry`: error display is downstream of `compile_typst`; **Rust payload stays unchanged** (`TypstError { message, line, file }`, warnings still dropped).

## Approaches considered

1. **In-pane sticky bar (chosen).** Move the banner inside `#preview` as first child, `position: sticky; top: 0`. `#preview` is itself the scroll container (`overflow: auto`, styles.css:66), so the bar pins while pages scroll and occupies its own flow space (no overlap). Zero layout surgery: no `index.html` change, no splitter-selector fix, no `uilayout.ts` change, no test-fixture rework. Complications handled explicitly: `pane().innerHTML` writes on success would orphan the cached banner element, so the cache must be invalidated (connected-check), the bar is lazily recreated on the next error.
2. **Wrapper column** (`<div id="preview-col">` in index.html wrapping banner + `#preview`): "proper" column structure, but requires moving `width/border/padding` rules, fixing the `:has` handle selector, and updating test fixtures. More churn for the same visible result.
3. **Absolute overlay**: banner absolutely positioned over the preview top. Overlaps first-page content and needs a positioning anchor; strictly worse than sticky here.

## Behavior spec

- Bar is a child of `#preview`, full-bleed across the pane (cancel the pane's `0 16px` padding with negative margins), pinned via `position: sticky; top: 0`.
- Single line: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` + `title` attribute with the full multi-error text (first error + remaining count).
- Message text unchanged: `${filePart}${linePart}${message}` exactly as `showErrorBanner` formats today (incl. the `lastCompileRoot` gate on the `file:` prefix).
- `+N` badge when `errors.length > 1`; hidden otherwise.
- ✕ button (`type="button"`, styled after `.tab-close`) hides the bar; the next compile result (edit, tab switch back) re-evaluates it, so a persistent error re-appears, intended.
- Hide triggers unchanged: successful typst compile, markdown/CSV branch, `setPreviewVisible(false)`.
- Styling moves from inline styles to a `#preview-error` block in `src/styles.css` with the theme-aware red pair used by `.plot-error` (incl. dark override). No new CSS file, no dependencies.

## Out of scope

- Full error-list panel / click-to-jump-to-line.
- Warnings or severity levels (Rust drops warnings today).
- Markdown/CSV/mermaid/plot error surfaces (unchanged).
