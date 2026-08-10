# Typst Single-File Live Preview — Design

- **Date:** 2026-08-10
- **Topic:** `typst`
- **Status:** Spec (approved, ready to execute)
- **Scope:** One new Tauri command + `World` impl in Rust; preview-pane dispatch + race-guarded async render + error banner in TypeScript; `.typ`/`.typst` file association. **No folder/project model, no `#include`/`#import` resolution, no `@preview` packages, no system fonts, no PDF export.** Those are a separate folder-mode slice.
- **Author:** Planner session 2026-08-10
- **Depends on:** existing preview pane (`src/preview.ts`), `applyPreviewMode()` in `src/main.ts:181-186`, multi-tab runtime in `src/main.ts` (typst render targets the active tab's text, same as markdown).
- **Supersedes:** none.

## 1. Problem / intent

User intent (verbatim):

> Would it be feasible to also implement a full typst editor and renderer into klad? being able to open a typst folder and it can render properly at once.

Clarified through brainstorming (2026-08-10, four forks resolved):

1. **Scope of v1:** *Single-file preview now; folder/project mode as a follow-up plan.* The "open a typst folder" part — file tree, multi-buffer, `#include`/`#import` resolution, `@preview` packages, system fonts — is roughly 80% of a typst.app clone and is **out of scope** for this spec. v1 ships the renderer against a single buffer to prove the compile loop earns the rest.
2. **Compiler location:** *Rust crate in Tauri backend.* The `typst` crate runs natively alongside the existing `src-tauri` Rust; no WASM blob in the webview (keeps the frontend thin per AGENTS.md; no new frontend dep).
3. **PDF export:** *Preview-only.* The compile pipeline could emit PDF (~20-30 LOC on top via `typst-pdf`), but v1 ships just SVG-in-pane. Export defers to a later slice.
4. **Live update:** Same debounced-on-keystroke model as Markdown today, at a longer debounce (400ms vs 150ms) because typst compile is heavier than `marked()`.

So: open a `.typ` file in klad, see live typst-rendered pages in the preview pane, debounced on keystroke. **That is the entire v1 feature surface.**

## 2. Why typst is not just "another `marked()`"

Markdown preview today is 15 lines (`src/render.ts`: `marked.parse` + `DOMPurify.sanitize`, sync, ~ms). Typst is a real typesetter. The deltas that shape this spec:

| Concern | Markdown today | Typst v1 (this spec) |
|---|---|---|
| Render call | `marked.parse(text)` sync in JS | `typst::compile(&world)` in Rust via Tauri IPC, async on the frontend |
| World / inputs | none — pure function of text | a `World` trait impl providing source, fonts, library, file/id resolution |
| Output | HTML string → `innerHTML` | per-page SVG strings → stacked in the pane |
| Fonts | browser fonts | embedded `typst-assets::fonts()` only (no system fonts in v1) |
| Cost on keystroke | ~ms | ~10-50ms for small docs, hundreds of ms for big ones; needs debounce + a render-token race guard |
| File lookups | n/a | `#include`/`#import`/packages **return errors in v1** (no fs resolver; surface as compile errors) |

The renderer is doable in one focused pass. The folder/project model is a separate spec — explicitly deferred (§9).

## 3. Architecture

### 3.1 Backend (new module `src-tauri/src/typst_compile.rs`)

One Tauri command, one `World` impl, no I/O.

```
compile_typst(text: String) -> TypstResult
    where TypstResult = { pages: Vec<String>, errors: Vec<TypstError> }
          TypstError  = { message: String, line: Option<u32> }
```

- Pages are SVG strings (one per typst page). Frontend stacks them vertically.
- Errors carry the diagnostic message + the line number in the source if typst attaches one. **No `codespan-reporting`** — ponytail: format the message + line manually from `SourceDiagnostic`, the banner only needs "line N: message". Prettier formatting defers to folder mode.
- On compile failure: `pages: []`, `errors: <non-empty>`. The frontend keeps the last-good render and shows the error banner (§3.2). We do **not** ask typst for partial output on error in v1; last-good + banner is the whole UX.

**`SingleFileWorld`** (implements `typst::World`):

- `source` (root): a `typst::syntax::Source` built from `text` (LF-normalized — klad's editor buffer is already LF, AGENTS.md).
- `book` / `font`: backed by `typst-assets::fonts()` — embedded at compile time, no fs scan.
- `file(id)` / `resolve(path)` / `package(spec)`: any non-root file/package lookup in v1 returns an error. This makes `#include "other.typ"`, `#import "foo.typ"`, and `@preview/...` all surface as clean typst compile errors (e.g. "file not found: other.typ"), which we forward to the banner. **This is the contract that bounds v1 to single-file.**
- `today`: delegates to `chrono`/`time` (typst's transitive dep) or a stub returning the system date — verify against the pinned version's `World::today` signature.

### 3.2 Frontend (extend `src/preview.ts`, no new module)

`src/preview.ts` is already the "render into the preview pane" module. It learns two render kinds instead of one.

- New module-level state: `previewKind: 'md' | 'typ'`. Set by a new exported `setPreviewKind(kind)` that `applyPreviewMode()` in `main.ts` calls alongside `setPreviewVisible`.
- `renderPreviewNow(text)` branches on `previewKind`:
  - `'md'` (unchanged): `pane().innerHTML = renderMarkdown(text)` — sync, as today.
  - `'typ'`: kicks off `compileTypst(text)` (async invoke), then **race-guarded** by a monotonic token: capture `++renderToken` before the await; on resolve, only apply if `token === renderToken`. Stale compiles (user typed more) drop silently. On success, stack per-page SVGs in the pane; on error, leave the last-good pane contents in place and show the banner.
- `updatePreview = debounce(renderPreviewNow, ...)`: split into two debounce instances — 150ms for md (unchanged), 400ms for typ. Dispatch picks based on `previewKind`. (Two short-lived timers, one per kind; ponytail: not a registry.)
- **Error banner**: lazily created `<div id="preview-error">` attached once to the pane's parent, shown when `errors.length > 0`, hidden when a compile succeeds. Holds the first error's `line: message`. Built from TS — no `index.html` markup change (AGENTS.md: `<dialog>` and direct DOM).
- **Pane flash on first open**: when `applyPreviewMode` shows the pane for a `.typ` file, the pane is briefly empty until the first compile resolves (~tens of ms). Acceptable; not worth a placeholder.

### 3.3 File-type detection & association

- `src/main.ts:177` `isMarkdown(m)` stays; add `isTypst(m) = /\.(typ|typst)$/i.test(m.path ?? "")`. `applyPreviewMode` computes which kind applies and calls `setPreviewKind` + `setPreviewVisible` accordingly. If both predicates miss, preview hides (current behavior for non-md files).
- The menu "Preview" checkbox (`menuHandles?.previewItem.setChecked(on)`) stays in sync with whatever kind is active. The checkbox label does not change in v1 — it says "Preview", the kind is implicit in the file type.
- **Tab switch / Save As path change**: `applyPreviewMode` already runs on tab switch and after Save As (`main.ts:205, 219, 282, 346`). Because `previewKind` is derived from the active tab's `meta.path`, switching to a tab of a different kind flips the renderer automatically.
- Open-file filters (`main.ts:34` `FILTERS`): add `typ` and `typst` to the "Text files" extensions list so the Open dialog shows them.
- `tauri.conf.json` `bundle.fileAssociations`: add `{ ext: ["typ", "typst"], name: "Typst Document", description: "Typst Document", mimeType: "text/x-typst", role: "Editor" }`. Lets the OS double-click `.typ` files into klad on Windows + Linux.

## 4. The exact contract (no ambiguity)

### 4.1 `compile_typst` Tauri command

```rust
#[derive(Serialize)]
pub struct TypstError {
    pub message: String,
    pub line: Option<u32>,
}

#[derive(Serialize)]
pub struct TypstResult {
    pub pages: Vec<String>,    // SVG strings, one per page; empty on error
    pub errors: Vec<TypstError>, // empty on success
}

#[tauri::command]
pub fn compile_typst(text: String) -> Result<TypstResult, String> {
    // Build SingleFileWorld from text, call typst::compile, render pages to SVG.
    // Hard errors (panics, font setup failure) → Err(String). Compile errors → Ok with errors filled.
}
```

The outer `Result<_, String>` is for "the world is broken" (e.g. font init panics); typst *compile* errors are **not** IPC errors, they're data inside `TypstResult.errors`. This matches how `read_file` reports fs errors but keeps decode heuristics inside the success type.

### 4.2 Frontend race guard

```ts
// in src/preview.ts
let renderToken = 0;

async function renderTypstNow(text: string): Promise<void> {
  const token = ++renderToken;
  const result = await compileTypst(text);
  if (token !== renderToken) return; // a newer render is in flight; drop
  applyTypstResult(result);
}
```

This is the only correctness-critical piece of new frontend logic. The token check is what prevents a stale compile (slow, from an older buffer state) from overwriting the pane after a newer compile has already rendered. **Must be unit-tested** (§7).

### 4.3 `applyPreviewMode` rewrite

```ts
function applyPreviewMode(): void {
  const md = isMarkdown(meta);
  const typ = isTypst(meta);
  const kind: "md" | "typ" | null = md ? "md" : typ ? "typ" : null;
  setPreviewVisible(kind !== null);
  setPreviewKind(kind === "typ" ? "typ" : "md"); // setter is a no-op effect when preview hidden
  if (kind) renderPreviewNow(getText(activeTab().view));
  void menuHandles?.previewItem.setChecked(kind !== null);
}
```

`setPreviewKind` must be called **before** `renderPreviewNow` so the dispatch picks the right branch on the synchronous md path. (For typ the kind matters inside the async branch.)

## 5. Behavior matrix

| Active tab file | Preview visible? | Render kind | On keystroke |
|---|---|---|---|
| `foo.md` | yes | md | sync `marked()`, 150ms debounce (unchanged) |
| `foo.typ` | yes | typ | async `compile_typst`, 400ms debounce, token-guarded |
| `foo.txt` / no ext / unknown | no | n/a | n/a (unchanged) |
| `foo.typ` with compile error | yes | typ | last-good SVG stays; error banner shown; further keystrokes re-attempt |
| Tab switch md → typ | yes (re-renders) | flips md → typ | next keystroke uses typ debounce |
| Tab switch typ → txt | hides | n/a | n/a |

## 6. Catalog updates (per AGENTS.md)

| Catalog | Touched? | Change |
|---|---|---|
| `src-tauri/src/main.rs` `invoke_handler![]` | **Yes** | Add `typst_compile::compile_typst`. |
| `src-tauri/src/typst_compile.rs` | **Yes (new file)** | Command + `SingleFileWorld` + tests. |
| `src/fileio.ts` | **Yes** | Add `compileTypst(text): Promise<TypstResult>` wrapper. |
| `src/preview.ts` | **Yes** | `previewKind` state, `setPreviewKind`, race-guarded `renderTypstNow`, dispatch in `renderPreviewNow`, two debounce instances, error banner. |
| `src/main.ts` | **Yes** | `isTypst()` predicate; `applyPreviewMode` rewrite (§4.3); add `typ`/`typst` to `FILTERS`. |
| `src-tauri/tauri.conf.json` `fileAssociations` | **Yes** | Add `.typ` + `.typst` association. |
| `src-tauri/capabilities/default.json` | **No** | `compile_typst` is compute-only (String in, strings out, no fs scope). **No new permission.** |
| `src-tauri/Cargo.toml` deps | **Yes** | Add `typst`, `typst-assets` (`fonts` feature). SVG emission is part of the `typst` crate in recent versions; if the pinned version splits it into `typst-svg`, add that. `ecow`/`comemo` come transitively. |
| `package.json` deps | **No** | No frontend dep. |
| `index.html` | **No** | Error banner built from TS, no markup change. |
| `src/menu.ts` | **No** | Menu item already exists; only its checked state flips. |
| `src/render.ts` | **No** | Stays markdown-only. Typst does not go through `renderMarkdown`. |

No red flags: every Tauri command is wired into both `main.rs` and `fileio.ts`; no two catalogs disagree about the `.typ` association; no new capability added because none is needed.

## 7. Testing strategy

### 7.1 Backend inline test (`src-tauri/src/typst_compile.rs`, `#[cfg(test)]`)

- `compiles_trivial_doc`: `compile_typst("#set page(width: 40pt)\nHi")` → `pages.len() >= 1`, each page SVG contains `<svg`, `errors.is_empty()`.
- `returns_errors_for_broken_doc`: `compile_typst("#set page(width: )")` (malformed) → `pages.is_empty()`, `errors.len() >= 1`, at least one error has a `line`.
- `include_is_error_in_v1`: `compile_typst("#include \"other.typ\"")` → `pages.is_empty()` (or non-empty if typst short-circuits), `errors` mentions the file. Pins the v1 boundary: a file lookup is a clean error, not a panic.
- Font setup must work in `cargo test` (embedded assets are available at test time; no fs scan).

Run: `cargo test --manifest-path src-tauri/Cargo.toml`. Expected: all existing fs_cmds tests **plus** the new typst tests pass; 0 failed.

### 7.2 Frontend tests (`src/__tests__/`, vitest)

Per project convention (tabs spec §12: pure-logic tests only, no Tauri IPC mocking, no CodeMirror mocking):

- **Race guard test** (the critical one): extract the token-guard logic into a tiny pure helper if it makes the test clean (e.g. `pickLatest<T>(token, latestRef, value)`) OR test the dispatch by injecting a stubbed `compileTypst` that resolves in a controlled order. Verify: a slow in-flight compile that resolves *after* a newer compile does **not** overwrite the newer render's output. This is the only piece of new logic that can fail silently — it must have a runnable check.
- **Kind-dispatch test**: a pure predicate `previewKindForPath(path)` (extracted from the `isTypst`/`isMarkdown` derivation) returns `"md" | "typ" | null`. Cover all three branches + case-insensitivity.
- **Path predicate test**: `isTypst("foo.TYP")`, `isTypst("foo.typst")`, `isTypst("foo.txt")` (negative).

Run: `npm test`. Expected: existing suite + new tests, 0 failed.
Run: `npx tsc --noEmit`. Expected: exit 0.

### 7.3 Manual smoke test (acceptance)

Build once: `cargo build --manifest-path src-tauri/Cargo.toml` then `npm run tauri dev` (or run the dev build). Scenarios:

1. **Open `.typ` → renders:** Create `test.typ` containing `#set page(width: 200pt)\nHello #emph[typst]`. Open in klad. Preview pane shows 1 SVG page with rendered text + italic. No banner.
2. **Live keystroke:** Append `\n= Heading`. Within ~400ms the preview updates to show the heading. No flicker from stale renders when typing fast.
3. **Compile error → banner, last-good stays:** Replace contents with `#set page(width: )`. Within ~400ms the **last good render stays on screen** and a red banner appears with "line N: ...". Fix the source; banner disappears, fresh render replaces last-good.
4. **v1 boundary — `#include` is a clean error:** `#include "other.typ"` → banner mentions the missing file. **No crash, no panic.**
5. **Tab switch md ↔ typ:** Open `a.md` and `b.typ`. Switch tabs; pane re-renders with the right kind each direction. No stale cross-kind content.
6. **Tab switch typ → txt:** Open `c.txt`. Preview hides. Switch back to `b.typ`; preview re-shows and re-renders.
7. **Open dialog filter:** `Ctrl+O` → "Text files" filter shows `typ` and `typst` extensions.
8. **OS double-click (Windows):** Build the NSIS installer (or use a debug build with file associations registered). Double-click a `.typ` file → klad opens it, preview renders.
9. **Linux smoke:** Same 1-5 on the deb/appimage build in a VM or native Linux session.

All nine must pass. The race guard (#2 fast-typing) and the v1 boundary (#4) are the highest-risk scenarios.

## 8. Resolved decisions

| Decision | Resolution | Why |
|---|---|---|
| Scope of v1 | Single-file preview only | Brainstorm fork 1; folder mode is 80% of the cost, earns its own spec after the compile loop is proven. |
| Compiler location | `typst` crate in Rust backend | Brainstorm fork 2; AGENTS.md grain (Rust does heavy lifting), no WASM blob. |
| PDF export in v1 | No | Brainstorm fork 3; preview-only proves the loop. ~20-30 LOC add when folder mode lands. |
| Live update | Debounced on keystroke, 400ms | Markdown's 150ms is too tight for typst's cost; 400ms keeps it feeling live without thrashing. |
| Render kind dispatch location | Inside `src/preview.ts` via `setPreviewKind` | Keeps `main.ts` thin; preview.ts already owns the pane. |
| Output format | SVG per page | Vector, scalable, no DPI knob; smaller than PNG for text-heavy pages. typst.app uses the same model. |
| Fonts | Embedded (`typst-assets::fonts()`) only | No fs scan / `fontdb` dep in v1; system fonts are a folder-mode concern. `#set text(font: "Arial")` falls back to embedded; acceptable. |
| Error formatting | Manual, no `codespan-reporting` | The banner needs "line N: message", not pretty spans. Saves a dep surface. |
| Error UX | Keep last-good + banner | No blanking/flashing; user keeps visual context while typing through an error. |
| Race guard | Monotonic render token | Stale compile overwriting newer render is the only silent-failure risk; token check is one line. |
| `compile_typst` capability | None added | Compute-only command (String → strings); no fs scope. Called out so executor doesn't add a spurious permission. |

## 9. Known limitations / deferred (folder-mode slice)

These are deliberately out of scope and should be re-opened in a separate spec once v1 ships:

- **Folder/project model.** File tree, multi-buffer project root, `#include`/`#import` resolution across files. The biggest single piece.
- **`@preview` packages.** Network fetch + cache + namespace resolution. typst CLI does this; library users must implement.
- **System fonts.** `fontdb` integration to discover installed fonts so `#set text(font: "Arial")` works.
- **PDF export.** `typst-pdf` emits from the same `Document`; ~20-30 LOC + a save dialog wrapper.
- **Click error → jump to line.** The banner can show line N today; jumping the editor cursor there is a v1.5 polish.
- **Binary size.** typst + typst-assets + transitive deps (icu, comemo, hayagrifa) add ~5-15MB to the release binary. Acceptable for a desktop notepad; document as a known ceiling.
- **Compile cost on large docs.** A 100+ page book may take hundreds of ms per keystroke. v1's 400ms debounce handles small docs comfortably; if large docs lag, the upgrade path is "compile-on-save-only" toggle (settings), not incremental compilation in the library API (which is fragile across versions).
- **typst version drift.** The `typst` crate's `World` trait surface has shifted between minor versions. The plan pins a version and the executor verifies the trait surface before writing the impl; the upgrade path to a newer typst is a follow-up task with its own verification.

## 10. Open issues

- **typst version pin.** The spec does not hard-pin a typst version because the API surface (esp. `World`, `typst::compile`, SVG emission entry point) has shifted between minor releases. The plan instructs the executor to (a) resolve the latest stable `typst` + `typst-assets` at the start of Task 1, (b) read the actual trait/API for that version before writing `SingleFileWorld` and the SVG emission call, and (c) record the resolved versions in the task report. This is a deliberate "verify before-implement" gate, not an unbounded research task.
