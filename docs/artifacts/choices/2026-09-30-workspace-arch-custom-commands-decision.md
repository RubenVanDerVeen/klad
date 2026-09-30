# Workspace architecture: custom commands, no fs plugin

- Date: 2026-09-30
- Status: active
- Source: docs/artifacts/features/workspace/2026-09-30-workspace-folder-mode-design.md (§4), 2026-09-30-workspace-folder-mode-report.md

## Choice
Workspace folder mode is built on custom unrestricted Tauri commands (`list_dir`, extended `compile_typst`) using `std::fs`, a project-root branch inside `SingleFileWorld`, and an imperative-DOM tree module. No `tauri-plugin-fs`, no watcher, no new dependencies, no capability/scope changes (the `read_file`/`save_file` precedent).

## Alternatives rejected
- `tauri-plugin-fs` + `watch`: new dependency, runtime scope updates per opened folder, and a watcher event protocol, all for what one ~20-line command does.
- Eager full-tree scan with a frontend virtual FS: explodes on `node_modules`-sized directories, goes stale on external edits, and ships the whole project per keystroke.

## Revisit when
External-change staleness in the tree becomes a real complaint (then add a file watcher), or a security pass mandates scope-limited fs access instead of unrestricted custom commands.
