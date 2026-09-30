# Workspace / Folder Mode — Design

**Status:** approved (design forks confirmed by user 2026-09-30)
**Date:** 2026-09-30
**Feature:** open a directory in Klad, interactive file tree, multi-file Typst project compilation (imports resolve across files) — a first slice of the typst.app model.

## 1. Problem & goal

Klad opens single files only. A Typst project like
`~/projects/Schoolprojects/Aardbei-Plukkers/docs/source/typst` is many `.typ`
files that `#import` / `#include` each other; today every relative import is a
hard compile error (`typst_compile.rs` returns `FileError::NotFound` for all
non-package, non-entry lookups). Users also have no way to see or navigate a
project's files.

Goal:

1. **File > Open Folder…** selects a workspace root; a lazy-loading,
   interactive file tree appears in a left sidebar; clicking a file opens it
   in a tab (existing tab machinery).
2. With a workspace open, compiling the active `.typ` tab resolves
   `#import "..."` / `#include "..."` (and `#image(...)`/`read(...)`) against
   the workspace root, cross-file, so a real project renders.
3. Live preview keeps its hot-exit semantics: unsaved edits in *any* dirty
   tab under the root are visible in the compile (dirty-buffer overlay).

Out of scope (non-goals, YAGNI): create/rename/delete in the tree; filesystem
watching (expand re-lists the directory, which self-heals external changes);
multi-root workspaces; a designated "main file" (the active tab is always the
entry point); package-management UI; click-error-to-jump-to-line; system
fonts; PDF export; tree highlighting of the active file.

## 2. Prior art & superseded decisions

- `docs/artifacts/features/typst/2026-08-10-typst-single-file-preview-design.md`
  §9 explicitly deferred "folder/project model … the biggest single piece" —
  this feature is that slice.
- `docs/artifacts/features/typst-packages/2026-09-26-typst-packages-design.md`
  line 27: *"relative `#include`/`#import` … stays a clean error (unchanged v1
  boundary)"* — **superseded by this feature.** The Rust test
  `include_is_clean_error_in_v1` (`typst_compile.rs:335`) codifies the old
  boundary and **must be rewritten**, not just extended. (Documenter: flip the
  typst-packages decision entry's status at close-out.)
- Carried patterns: `VirtualRoot::Package(spec)` branch in `source()`/`file()`
  (typst 0.15.1, no `World::package` method — resolution lives in the world);
  `Source::new(id, text)` (not `detached`) so spans resolve per file;
  test-injectable temp dirs for package tests.
- No `docs/artifacts/choices/` entries exist for workspace/folder/tree topics.

## 3. Confirmed design decisions

| Fork | Decision |
|---|---|
| Imports of unsaved files | **Dirty-buffer overlay**: live text of dirty tabs under the root is sent with each compile |
| Tree v1 | **Open-on-click only** (expand/collapse dirs, click files); no file management |
| Persistence | **Restore last workspace** on launch (new localStorage key, session/settings pattern) |
| Compile entry | **Active tab is the entry point**; its imports resolve against the root (typst.app model) |

## 4. Approaches considered

**A. Extend existing patterns (chosen).** One new tiny Rust command
(`list_dir`), project-root resolution inside the existing `SingleFileWorld`,
an imperative-DOM tree module modeled on `tabbar.ts`, one new localStorage
key. No new dependencies, no fs plugin, no capability changes (custom
commands with unrestricted `std::fs` — the exact precedent of
`read_file`/`save_file`, which also deliberately carry no fs scope).

**B. `tauri-plugin-fs` + watcher.** Plugin `readDir`/`watch` with runtime
scope updates for the opened folder. Rejected: new dependency + capability
scoping + watcher event plumbing for what one ~20-line command does; watchers
add a refresh protocol the tree doesn't need.

**C. Eager full-tree scan, virtual FS in frontend.** Walk everything once,
ship the whole project to the backend per compile. Rejected: explodes on
`node_modules`/`target`-sized dirs, stales on external edits, bigger payloads
per keystroke.

## 5. Architecture

### 5.1 Backend (Rust, `src-tauri/src/`)

**New command `list_dir`** (in `fs_cmds.rs`, registered in `main.rs`):

```rust
#[derive(Serialize)] // name, path, is_dir
pub struct DirEntry { pub name: String, pub path: String, pub is_dir: bool }

#[tauri::command(async)]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String>
```

- Reads `std::fs::read_dir`; sorts dirs first, then files, each
  case-insensitive alphabetical by name.
- Skips dotfiles (`.git`, `.typst` cache, …). `// ponytail: no ignore-file
  support; add .gitignore awareness if big build dirs annoy in practice.`
- IO error → `Err(String)` (existing command error style).

**`compile_typst` signature** (`typst_compile.rs`):

```rust
#[tauri::command(async)]
pub fn compile_typst(
    text: String,                       // live text of active buffer (unchanged)
    path: Option<String>,               // absolute path of active file, None = untitled
    root: Option<String>,               // workspace root, None = single-file mode
    overrides: HashMap<String, String>, // relpath (forward slashes) -> live dirty text
) -> Result<TypstResult, String>
```

**World changes** (`SingleFileWorld`):

- Entry source id: if `root` and `path` are both `Some` **and** `path` is
  under `root` (component-wise prefix), build the entry `FileId` with the
  project virtual root + the entry's vpath (relpath of `path` under `root`),
  and `Source::new(id, text)` instead of `Source::detached(text)`. Otherwise
  (no root, untitled, or file outside the root) keep today's detached
  single-file behavior — imports stay clean errors there.
- `source(id)`: keep the package branch; add a project-root branch —
  relpath = `id.vpath().get_with_slash()`; if `overrides` contains relpath →
  `Source::new(id, override_text)`; else `std::fs::read_to_string(root.join(
  vpath components))` → `Source::new(id, text)`. Map io errors to typst
  `FileError` variants (`NotFound`, access → denied variant, invalid UTF-8 →
  the utf-8 variant if present, else `Other`; follow the variants the file
  already imports).
- `file(id)`: same project branch, disk read only (binary assets can't come
  from text buffers) → `Bytes`.
- Exact `VirtualRoot` variant spellings in typst 0.15.1: verify against the
  crate's syntax module as imported in this file (`VirtualRoot::Package` is
  the in-file precedent) and adapt.

**Diagnostics**: `TypstError` gains `file: Option<String>` — relpath of the
span's source whenever it resolves (`None` only when the span carries no
file, e.g. detached single-file mode). `format_diag` populates it from the
span's source id. Error banner shows `path:line: message` when present.

**No changes** to fonts, package resolution, `TypstResult` shape (beyond the
error field), or `main.rs` beyond registering `list_dir`.

### 5.2 Frontend (`src/`, `index.html`)

**`src/workspace.ts` (new)** — pure, testable:

```ts
interface WorkspaceState { root: string }
loadWorkspace(): WorkspaceState | null   // localStorage "klad-workspace", validated
saveWorkspace(root: string): void
clearWorkspace(): void
relPathUnder(root: string, path: string): string | null  // null = outside; '/'-separated output, handles '\\' input
collectOverrides(entries: {path: string|null; dirty: boolean; text: string}[],
                 root: string, excludePath?: string): Record<string, string>
```

`collectOverrides` = dirty tabs under root, minus the active tab (its live
text already travels as `text`), keyed by relpath.

**`src/tree.ts` (new)** — imperative DOM, `tabbar.ts` pattern:

```ts
interface TreeHooks { onOpen(path: string): void }
initTree(hooks: TreeHooks): void          // binds #tree container
renderTreeRoot(root: string): void        // title + root's children
clearTree(): void
// plus exported pure helpers: sortEntries, filterEntries (dotfile skip)
```

- Directory rows toggle expand/collapse; **every expand re-lists via
  `list_dir`** (no cache → external changes self-heal; `// ponytail:` note).
- File rows call `hooks.onOpen(path)` → existing `openPath` (tab dedup
  already free). Text-only rows with indent + `▸/▾` markers, theme CSS vars.
- No active-file highlight (deferred).

**Layout** (`index.html`, `styles.css`): `<aside id="sidebar" hidden>` with a
header (workspace basename) and `#tree` becomes the first flex child of
`#content`, fixed ~220px, `overflow-y: auto`; `hidden` when no workspace.

**Menu** (`menu.ts`): `MenuActions` gains `onOpenFolder`, `onCloseFolder`;
two items in the File submenu after Open…. Close Folder is always enabled
and no-ops when no workspace is open (no dynamic menu state).

**Preview wiring** (`preview.ts`, `main.ts`, `fileio.ts`):

- `fileio.ts`: `listDir(path)` wrapper; `compileTypst(text, path, root,
  overrides)` extended signature.
- `preview.ts`: `setTypstProjectProvider(fn: () => { path: string | null;
  root: string | null; overrides: Record<string, string> } | null)` — module
  state mirroring the `setPreviewBaseDir` precedent, but function-valued so
  every compile reads fresh tab state. `renderTypst` passes the provider's
  values into `compileTypst`; provider null / root null → today's args
  (`null, null, {}`).
- `main.ts`: `openFolder()` = `openDialog({ directory: true })` → save
  workspace, `renderTreeRoot`, unhide sidebar, refresh provider. On tab
  switch/open/save-as and on open/close folder, re-invoke
  `setTypstProjectProvider` with a closure over current state (`path` from
  active tab meta, `root` from workspace, `overrides` from
  `collectOverrides` over live tabs). `closeFolder()` = clear storage, hide
  sidebar, `clearTree`, refresh provider.
- **Startup restore**: after session restore, if a stored workspace exists,
  silently reopen it (tree + sidebar + provider). If the first `list_dir`
  fails (dir moved/deleted), clear the stored workspace instead of erroring.
- Session restore itself is untouched — tabs and workspace restore
  independently.

### 5.3 Data flow (one compile)

```
keystroke → debounce 400ms → preview.renderTypst
  → provider() → { path: "/root/ch1/main.typ", root: "/root",
                   overrides: { "lib.typ": "<dirty live text>" } }
  → invoke compile_typst(text, path, root, overrides)
  → SingleFileWorld: entry FileId(project root, "ch1/main.typ"), Source::new
  → typst engine resolves #import "../lib.typ" → FileId(project, "lib.typ")
  → world.source(id): override hit → live text (else disk read)
  → pages SVG / errors {message, line, file: Some("lib.typ")}
  → #preview pane / banner "lib.typ:12: unknown variable: x"
```

## 6. Error handling

- Missing import file → existing clean-error path (`FileError::NotFound` →
  banner, last-good preview kept) — now also when the root is set but the
  file doesn't exist. Message already carries the path.
- `list_dir` IO error (workspace deleted externally) → sidebar shows inline
  "cannot list" message on that node; startup case clears the stored
  workspace.
- Non-UTF-8 imported `.typ` → clean compile error (utf-8 `FileError`
  variant), not a panic.
- `overrides` entries never touch disk; a stale override for a since-deleted
  file simply still compiles (harmless, matches the buffer's reality).

## 7. Testing

**Rust (`cargo test`)** — all with temp fixture dirs (`std::env::temp_dir()`, pid-named, manual `remove_dir_all` cleanup — the existing test style):

1. Rewrite `include_is_clean_error_in_v1` → **project mode compiles**: temp
   root with `lib.typ` + `ch1/main.typ` importing it; `compile_typst` with
   `root`+`path`; assert pages render, no errors. (The flipped boundary is
   this feature's acceptance test.)
2. **Override wins over disk**: same layout, `lib.typ` on disk says A,
   `overrides["lib.typ"]` says B; assert rendered output contains B.
3. **Missing import stays clean error**: import `"nope.typ"` → error result,
   message mentions `nope.typ`, no panic.
4. **Entry outside root falls back to detached**: `path` not under `root` →
   relative import errors exactly as v1.
5. **Binary `file()` resolves**: `#image("tiny.png")` with an embedded 1×1
   PNG in temp root renders (covers the `file()` project branch).
6. **`list_dir`**: dirs-first ordering, dotfiles skipped, `is_dir` flags.
7. **Per-file diagnostics**: error inside `lib.typ` → `errors[0].file ==
   Some("lib.typ")` and line resolves in that file.

**Frontend (`npm test`)** — Vitest, following existing module tests:

1. `workspace.test.ts`: parse/validate/clamp, round-trip, `relPathUnder`
   (posix + windows separators, outside → null), `collectOverrides` (dirty
   filter, root filter, active excluded).
2. `tree.test.ts`: pure `sortEntries`/`filterEntries` (dotfile skip,
   dirs-first, case-insensitive).
3. `typst-preview.test.ts` extension: provider null → legacy args; provider
   set → invoke called with `(text, path, root, overrides)` (mock invoke).
4. `singleinstance`/`tabs`/`session` tests must stay green untouched.

**Manual smoke** on `~/projects/Schoolprojects/Aardbei-Plukkers/docs/source/typst`:
open folder → tree lists project → open the entry `.typ` → multi-file project
renders; edit an imported file in a second tab without saving → preview
reflects it; break an import → banner names the file and line; close folder →
sidebar hides, single-file behavior returns; relaunch → workspace restored.

## 8. Catalog updates (AGENTS.md rule — same change)

- `src-tauri/src/main.rs`: register `list_dir`.
- `src/fileio.ts`: `listDir`; `compileTypst` signature.
- `capabilities/default.json`, `tauri.conf.json`, `package.json`,
  `src-tauri/Cargo.toml`: **no changes** (no new deps, no fs scope — custom
  unrestricted commands, `read_file` precedent).
- `index.html`: sidebar + tree markup.
- `README.md` (feature mention), `CHANGELOG.md` `[Unreleased]` → Added, and
  the AGENTS.md component table row for the sidebar/workspace when shipped.

## 9. Versioning

Minor bump expected: `0.6.0 → 0.7.0` (new backward-compatible functionality;
canonical `src-tauri/tauri.conf.json`, sync `package.json` +
`src-tauri/Cargo.toml`). Release cutting stays deliberate; documenter bumps
at close-out.

## 10. Known ceilings (ponytail notes)

- No fs watching; expand re-lists. Add `notify` watcher if staleness bites.
- No tree file management, no active-file highlight, no ignore-file support.
- One workspace root at a time.
- Dirty overlay covers text files only; binary assets always read from disk.
