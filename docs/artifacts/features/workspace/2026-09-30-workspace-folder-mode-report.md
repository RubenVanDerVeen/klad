# Workspace / Folder Mode - Execution Report

- **Date:** 2026-09-30
- **Branch:** `feat/workspace` (cut from `main`, 9 commits)
- **Final HEAD (code):** `d4e304f`; close-out adds the `chore(release): v0.7.0` ship-bump commit (report + superseded marker + version bump)
- **Status:** **DONE - backend 25/25, frontend 113/113, typecheck clean, clippy clean; manual smoke outstanding (user-invoked, non-blocking)**
- **Spec:** [`2026-09-30-workspace-folder-mode-design.md`](2026-09-30-workspace-folder-mode-design.md)
- **Plan:** [`2026-09-30-workspace-folder-mode-plan.md`](2026-09-30-workspace-folder-mode-plan.md)

## Summary

Klad gains workspace/folder mode: `File > Open Folder…` picks a workspace root, rendered as a lazy-loading interactive file tree in a left sidebar (click a file → opens in a tab). With a folder open, Typst compilation builds the entry `FileId` against a project virtual root, so relative `#import`/`#include` and binary assets (`#image`) resolve across files on disk; unsaved edits in *any* dirty tab under the root travel as a text override map (dirty-buffer overlay), giving typst.app-style live multi-file preview. The workspace persists in `localStorage` and restores on launch (silently cleared if the dir vanished). One new Rust command (`list_dir`), no new dependencies, no capability changes.

This flips the typst-packages v1 boundary ("relative imports stay a clean error") - see [Superseded decision](#superseded-decision-flip) below.

## Branch and commits

Oldest-first, linear history, base `main`:

| SHA | Type | Subject |
|---|---|---|
| `463e027` | docs | add workspace folder mode design and plan |
| `e66b717` | feat(workspace) | add workspace state and sidebar tree modules (Task 3, Wave 1) |
| `ae4fa48` | feat(fs) | add list_dir command for workspace tree (Task 1, Wave 1) |
| `0c264c8` | feat(typst) | resolve imports against workspace root with dirty-buffer overlay (Task 2, Wave 1) |
| `5f3b022` | feat(preview) | pass workspace project context to typst compile (Task 4, Wave 2) |
| `54c4da7` | feat(ui) | workspace sidebar with file tree and folder menu (Task 5, Wave 3) |
| `b3b6246` | fix(ui) | disambiguate Ctrl+Shift+O open-folder vs Ctrl+O open-file keydown (Task 5 follow-up) |
| `8fc7544` | docs | catalog workspace folder mode (Task 6, Wave 4) |
| `d4e304f` | chore | structure-review quick-fixes (readme limits, localStorage guard, fmt/clippy, eol) |

## Files changed (diff stats, `main..feat/workspace`)

```
 AGENTS.md                                          |   1 +
 CHANGELOG.md                                       |   6 +
 README.md                                          |   5 +-
 .../2026-09-30-workspace-folder-mode-design.md     | 290 ++++++
 .../2026-09-30-workspace-folder-mode-plan.md       | 982 +++++++++++++++++
 index.html                                         |   4 +
 src-tauri/src/fs_cmds.rs                           |  64 ++
 src-tauri/src/main.rs                              |   1 +
 src-tauri/src/typst_compile.rs                     | 366 ++++++--
 src/__tests__/tree.test.ts                         |  18 +
 src/__tests__/typst-preview.test.ts                |  14 +-
 src/__tests__/workspace.test.ts                    |  55 ++
 src/fileio.ts                                      |   20 +-
 src/main.ts                                        |  65 +-
 src/menu.ts                                        |   4 +
 src/preview.ts                                     |   37 +-
 src/styles.css                                     |   32 +
 src/tree.ts                                        |   82 ++
 src/workspace.ts                                   |   75 ++
 19 files changed, 2030 insertions(+), 91 deletions(-)
```

## Per-task summary

| Task | Commit | Files | Verification | Outcome |
|---|---|---|---|---|
| T1: `list_dir` command | `ae4fa48` | `src-tauri/src/fs_cmds.rs`, `src-tauri/src/main.rs` | `cargo test` green (2 new tests) | **PASS** |
| T2: project-root Typst world | `0c264c8` | `src-tauri/src/typst_compile.rs` | `cargo test` green (7 new/rewritten tests) | **PASS** |
| T3: `workspace.ts` + `tree.ts` | `e66b717` | `src/workspace.ts`, `src/tree.ts`, 2 test files | `npm test` + `npx tsc --noEmit` clean (9 new tests) | **PASS** |
| T4: IPC wrappers + preview wiring | `5f3b022` | `src/fileio.ts`, `src/preview.ts`, `src/__tests__/typst-preview.test.ts` | `npm test` + `npx tsc --noEmit` clean (2 new tests) | **PASS** |
| T5: sidebar UI + menu + wiring | `54c4da7`, `b3b6246` | `index.html`, `src/styles.css`, `src/menu.ts`, `src/main.ts` | `npm test` + `tsc` + `cargo test` (sanity) clean; manual smoke deferred to user | **PASS** |
| T6: catalogs & docs | `8fc7544` | `README.md`, `CHANGELOG.md`, `AGENTS.md` | catalog cross-check (below) | **PASS** |
| Structure-review quick-fixes | `d4e304f` | 7 files | full re-run green | **PASS** |

Wave structure per plan: Wave 1 (T1, T2, T3 parallel), Wave 2 (T4), Wave 3 (T5), Wave 4 (T6).

## Catalog updates landed (AGENTS.md "Adding features" rule)

| Catalog | Entry | Commit |
|---|---|---|
| `src-tauri/src/main.rs` | `fs_cmds::list_dir` registered in `generate_handler!` | `ae4fa48` |
| `src/fileio.ts` | `listDir(path)` wrapper; `compileTypst(text, path, root, overrides)` 4-arg signature; `DirEntry` + `TypstError.file` types | `5f3b022` |
| `index.html` | `<aside id="sidebar" hidden>` + `#sidebar-title` + `#tree` markup | `54c4da7` |
| `src/menu.ts` | `MenuActions.onOpenFolder`/`onCloseFolder`; File submenu items `Open Folder…` / `Close Folder` | `54c4da7` |
| `AGENTS.md` | Component table row: Workspace (`src/workspace.ts`, `src/tree.ts`) | `8fc7544` |
| `README.md` | Feature bullet (multi-file projects via Open Folder); Limitations scoped to "without an opened folder" | `8fc7544`, scoped in `d4e304f` |
| `CHANGELOG.md` | `[Unreleased]` → Added: 2 entries (created the section - none existed) | `8fc7544` |
| No changes (correctly) | `tauri.conf.json` associations, `capabilities/default.json`, `package.json`/`Cargo.toml` deps - no new dependencies, no fs scopes (custom unrestricted commands, `read_file` precedent) | - |

Catalog parity verified: every new item appears in each applicable catalog; no disagreements.

## Deviations from the plan

All behavior contracts and public signatures from the plan's `Interfaces: Produces` blocks were kept verbatim. Executor adaptations:

**Task 1** (`ae4fa48`)
- Reused the existing `tmp()` fixture helper in `fs_cmds.rs` instead of porting a new one from `typst_compile.rs`; `serde::Serialize` used unqualified per the file's existing import style.

**Task 2** (`0c264c8`) - typst 0.15.1 spelling adaptations, per plan Step 0 ("adapt the spelling, not the behavior"):
- `RootedPath` + `intern` for project-rooted `FileId`s; `VirtualRoot::Project` carries no path, so the world keeps its own root field (plan 3b anticipated this).
- `VirtualPath::new` returns `Result` (handled); disk paths via `vpath.realize(root)` with the crate's `FileError::Realize`; io errors mapped via `FileError::from_io` instead of a hand-rolled `map_file_error` - same behavior, less code.
- Override key uses `get_without_slash()` (vpath may be a dir-like prefix); `format_diag` resolves line numbers via `world.source(id).lines()`.
- `compile_with_packages` gated to `#[cfg(test)]`; `compile_typst` body rewritten with `if let` chains instead of the plan's nested `match` sketch.

**Task 3** (`e66b717`)
- Added `// @vitest-environment jsdom` to `workspace.test.ts` (matches the existing `debounce.test.ts` precedent). Plan said "no DOM needed" but `localStorage.clear()` in `beforeEach` requires the jsdom environment.

**Task 4** (`5f3b022`)
- `TypstError.file` kept optional (`file?: string | null`) in TypeScript to match the sibling `line?:` declaration style (Rust side stays `Option<String>`; wire format identical).
- Added `lastCompileRoot` module state + a gate in `showErrorBanner`: `main.typ:`-style file prefixes only render when the last compile ran in project mode - addresses the detached-mode prefix concern raised by the Task 2 reviewer.

**Task 5** (`54c4da7`, `b3b6246`)
- One-line fix in `currentTypstProject`: forces `root = null` when the active tab path is `null`, so an untitled tab never compiles in project mode (carry-forward from the Task 4 reviewer).
- Hover style uses the real CSS var `--hover-bg`; the plan's `var(--hover, …)` literal does not exist in `styles.css`.
- Added `CmdOrCtrl+Shift+O` accelerator on `Open Folder…`; follow-up `b3b6246` made the `Ctrl+O` keydown handler shift-aware so folder-open and file-open don't collide.
- Startup restore probes `listDir` before adopting the stored root (spec §5.2).

**Task 6** (`8fc7544`)
- Created the `[Unreleased]` section in `CHANGELOG.md` - the file had none (last release promoted straight to `[0.6.0]`). Frontmatter/preamble layout preserved.

**Structure-review quick-fixes** (`d4e304f`): README Limitations scoped to "without an opened folder"; `workspace.ts` gained a `localStorage` availability guard + try/catch around `setItem` (mirrors the existing session-module pattern); unused `vi` import dropped; trailing newlines restored; rustfmt applied at `fs_cmds.rs:325`; `typst_compile.rs` `utc_ymd`/`civil_from_unix_days` helpers moved above `mod tests`.

## Standardization review

Both audits: **PASS**, one quick-fix each, no deferred recommendations.

| Auditor | Finding | Disposition |
|---|---|---|
| doc-standardizer | README Limitations section still claimed "no relative imports" unconditionally, contradicting the new feature | Fixed in `d4e304f` (scoped to "without an opened folder") |
| code-standardizer | `workspace.ts` accessed `localStorage` unguarded (crashes in non-DOM embedding); missing EOF newline in one test file; rustfmt drift at `fs_cmds.rs:325`; test-helper ordering in `typst_compile.rs` | Fixed in `d4e304f` (guard + try/catch mirroring the existing session pattern, EOL, fmt, helper move) |

## Documentation updates

| Doc | Change | Commit |
|---|---|---|
| `README.md` | Feature bullet + Limitations scoping | `8fc7544`, `d4e304f` |
| `CHANGELOG.md` | `[Unreleased]` → Added (2 entries); promoted to `## [0.7.0] - 2026-09-30` by this close-out | `8fc7544` + release commit |
| `AGENTS.md` | Component table Workspace row | `8fc7544` |
| typst-packages design | Superseded marker on the v1 relative-import boundary (§3) | release commit |

## Verifier output (final state, post-`d4e304f`)

| Check | Command | Result |
|---|---|---|
| Backend tests | `cd src-tauri && cargo test` | **25/25 pass** - 11 `typst_compile` + 14 `fs_cmds` |
| Clippy | `cargo clippy` | clean, no warnings |
| rustfmt | `cargo fmt --check` (touched files, run toolchain) | clean at `d4e304f` |
| Frontend tests | `npm test` | **113/113 pass across 15 files** - 9 new (workspace 7, tree 2) + 2 `typstCompileArgs` in `typst-preview.test.ts` + 102 existing |
| Typecheck | `npx tsc --noEmit` | clean |

## Skills loaded

Per dispatch material: `executing-plans`, `dispatching-parallel-agents` (orchestrator).

## `ponytail:` deferrals

No new deferrals beyond the spec's §10 known ceilings, all deliberate and marked at their sites:
- No fs watching; every tree expand re-lists (`tree.ts`) - add a `notify` watcher if staleness bites.
- No ignore-file support; dotfile skip only (`fs_cmds.rs`) - add `.gitignore` awareness if big build dirs annoy.
- No tree file management, no active-file highlight; one workspace root at a time; dirty overlay covers text files only (binary assets always read from disk).
- The `workspace.ts` localStorage guard added in `d4e304f` mirrors the existing session-module pattern - not a new ceiling.

## Choices registry

No `docs/artifacts/choices/` entry: repo AGENTS.md forbids extra siblings under `docs/artifacts/` (only `features/<feature>/` is canonical), and no non-default executor choices required a decision record. Spec-level rejected approaches stay recorded in the spec §4:
- **Rejected:** `tauri-plugin-fs` + watcher (new dependency + capability scoping + refresh protocol for what one ~20-line command does).
- **Rejected:** eager full-tree scan / virtual FS in frontend (explodes on `node_modules`-sized dirs, stales, bigger per-keystroke payloads).

## Superseded decision flip

`docs/artifacts/features/typst-packages/2026-09-26-typst-packages-design.md` §3 line 27 - *"relative `#include`/`#import` … stays a clean error (unchanged v1 boundary)"* - is now marked **superseded by this feature** (callout + status-line note, original text kept as historical record). The codifying Rust test `include_is_clean_error_in_v1` was rewritten as `imports_error_without_root` in Task 2.

## Unverified items

- **Manual smoke (user-invoked, non-blocking):** `npm run tauri dev`, then per plan Task 5 Step 4 - open a real Typst project folder (tree lists, `.typ` files open in tabs, multi-file project renders); edit an imported file in a second tab without saving → preview reflects it; break an import → banner names `file:line:`; collapse/expand after external change → re-lists fresh; Close Folder → single-file behavior returns; relaunch → workspace restored, deleted root silently cleared. Recommended before tagging `v0.7.0`.
- **rustfmt toolchain drift (pre-existing, not branch drift):** under the locally installed rustfmt 1.9.0 (2026-09-01), `cargo fmt --check` flags formatting in files untouched by this branch (e.g. `build.rs`) as well; the repo's committed style predates that formatter. A repo-wide `cargo fmt` under the new toolchain is a separate maintenance decision, not part of this close-out.
- Tagging `v0.7.0` - deliberate, user-invoked per repo release policy.

## Dispatch Log

| Step | Dispatch |
|---|---|
| Task 1 | dispatched: executor + reviewer - both passed |
| Task 2 | dispatched: executor + reviewer - both passed (reviewer raised detached-mode prefix concern, resolved in Task 4) |
| Task 3 | dispatched: executor + reviewer - both passed |
| Task 4 | dispatched: executor + reviewer - both passed (reviewer carry-forward fixed in Task 5) |
| Task 5 | dispatched: executor + reviewer - both passed (carry-forward fix + follow-up `b3b6246`); manual smoke deferred to user |
| Task 6 | dispatched: executor + reviewer - both passed |
| Standardizers | dispatched: doc-standardizer (1 finding) + code-standardizer (1 finding) - both PASS, quick-fixes applied in `d4e304f` |
| Quick-fix re-check | passed (`d4e304f`) |
| Documenter | this report + typst-packages superseded flip + `chore(release): v0.7.0` ship-bump (0.6.0 → 0.7.0: canonical `src-tauri/tauri.conf.json`, sync `package.json` + `src-tauri/Cargo.toml`, CHANGELOG `[Unreleased]` → `[0.7.0] - 2026-09-30`) |
