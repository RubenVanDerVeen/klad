# Typst imports see unsaved buffers (dirty overlay)

- Date: 2026-09-30
- Status: active
- Source: docs/artifacts/features/workspace/2026-09-30-workspace-folder-mode-design.md (§3, §5.1), 2026-09-30-workspace-folder-mode-report.md

## Choice
`compile_typst` receives an `overrides` map (workspace-relpath -> live text) built from dirty tabs under the root; `SingleFileWorld::source` checks overrides before disk. Imports of unsaved files render in the live preview without saving. The active tab's text travels as the existing `text` argument and is excluded from the map.

## Alternatives rejected
- Disk-only imports: edits to imported files stay invisible until save, which contradicts Klad's otherwise live-preview feel (active buffer always compiled live).

## Revisit when
Override staleness causes bugs that matter (an override for a since-deleted file silently still compiles) or external-editor workflows dominate; then reconcile overrides against file mtime/size before applying.
