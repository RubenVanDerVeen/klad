# Panel resize/collapse: pointer-event splitters, no library, no CSS-only

- Date: 2026-10-06
- Status: active
- Source: docs/artifacts/features/panel-resize-collapse/2026-10-06-panel-resize-collapse-design.md (Approaches considered), 2026-10-06-panel-resize-collapse-report.md

## Choice
Column resizing is ~100 lines of hand-written Pointer Events code (`src/uilayout.ts`): thin handle divs between the panes, `setPointerCapture` drags, clamped widths written as CSS custom properties, state persisted in localStorage under `klad-ui`. Sidebar collapse via a View > Toggle Sidebar `CheckMenuItem` flipping the existing `hidden` attribute. No new dependencies, no framework UI.

## Alternatives rejected
- CSS-only `resize: horizontal` on the sidebar: native and zero JS, but the preview has no width anchor so it cannot be resized this way, no persistence hook, and collapse still needs JS. Half a solution.
- Split.js or another split-pane library: an external dependency for what is ~100 lines of pointer-event code.

## Revisit when
Pane behavior grows beyond drag/collapse (per-filetype widths, multi-window sync, keyboard resize) or drag handling shows bugs across the Tauri WebView versions - then a maintained split-pane library earns its dependency cost.
