# Active tab is the Typst compile entry

- Date: 2026-09-30
- Status: active
- Source: docs/artifacts/features/workspace/2026-09-30-workspace-folder-mode-design.md (§3), 2026-09-30-workspace-folder-mode-report.md

## Choice
In workspace mode the active `.typ` tab always compiles as the entry point; its imports resolve against the workspace root (the typst.app model). No designated main file, no per-project entry configuration. Files outside the root, untitled buffers, and no-workspace sessions fall back to detached single-file compilation.

## Alternatives rejected
- Designated main file per workspace: extra persisted state plus UI to pick/switch it, while the typical flow (open the document you are writing) needs no designation.

## Revisit when
Users regularly want a fixed entry while editing imported fragments (previewing `lib.typ` as a document becomes a complaint pattern); then add an opt-in per-workspace entry override.
