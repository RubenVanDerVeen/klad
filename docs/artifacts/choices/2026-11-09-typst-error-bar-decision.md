# Typst error bar: in-pane sticky bar, no wrapper column, no overlay

- Date: 2026-11-09
- Status: active
- Source: docs/artifacts/features/typst-error-bar/2026-11-09-typst-error-bar-design.md (Approaches considered), 2026-11-09-typst-error-bar-report.md

## Choice

The Typst error banner is the first child of `#preview` (the scroll container), pinned with `position: sticky; top: 0` and full-bleed via `margin: 0 -16px` canceling the pane's `0 16px` padding. Zero layout surgery: no `index.html` change, no wrapper column, no fix to the `#preview-handle:has(+ #preview[hidden])` splitter selector, no `uilayout.ts` change, no new dependencies. The cached bar element is invalidated with an `isConnected` check because `pane().innerHTML` on a successful render orphans it; the bar is lazily recreated on the next error.

## Alternatives rejected

- Wrapper column (`<div id="preview-col">` in index.html wrapping banner + `#preview`): the "proper" column structure, but requires moving width/border/padding rules, fixing the `:has` handle selector, and updating test fixtures. More churn for the same visible result.
- Absolute overlay: an absolutely positioned banner over the preview top overlaps the first page and needs a positioning anchor; strictly worse than sticky here.

## Carried constraint

The Rust payload stays unchanged: `TypstError { message, line, file }` in `src/fileio.ts`, warnings still dropped by the backend. The change is frontend-only.

## Revisit when

A full error-list panel or click-to-jump-to-line is added, or the Typst backend starts reporting warnings/severity levels; at that point the single-line bar with a `+N` badge is no longer a sufficient surface.
