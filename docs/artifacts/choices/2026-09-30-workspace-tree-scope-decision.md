# Workspace tree: open-on-click, lazy, no watcher

- Date: 2026-09-30
- Status: active
- Source: docs/artifacts/features/workspace/2026-09-30-workspace-folder-mode-design.md (§3, §5.2, §10), 2026-09-30-workspace-folder-mode-report.md

## Choice
The sidebar tree is open-on-click only: expand/collapse directories, click files to open tabs. Directory expansion re-lists via `list_dir` on every expand (no cache), dotfiles are skipped, one workspace root at a time. No create/rename/delete, no filesystem watching, no active-file highlight.

## Alternatives rejected
- Full file management (new/rename/delete): roughly doubles the tree UI plus confirm dialogs and error paths, for an editor whose saves already go through the existing tab flow.
- Filesystem watcher: a refresh protocol for marginal gain; re-listing on expand already self-heals external changes.

## Revisit when
External-change staleness bites between expand/collapse cycles, or file-management requests recur; add a watcher and CRUD then, in that order.
