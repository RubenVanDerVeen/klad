# Typst Single-File Live Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a `.typ`/`.typst` file in klad and see live typst-rendered pages in the preview pane, debounced on keystroke, alongside the existing Markdown preview.

**Architecture:** One new Tauri command `compile_typst(text) -> { pages: Vec<String-svg>, errors }` backed by a `SingleFileWorld` impl of typst's `World` trait (source from text, fonts embedded via `typst-assets`, all file/package lookups return errors). The existing `src/preview.ts` module learns a `previewKind: 'md' | 'typ'` state set by `applyPreviewMode()` in `main.ts`; on `'typ'` it fires a race-guarded async compile (monotonic render token) and stacks per-page SVGs, keeping last-good + showing an error banner on failure. No folder/project model, no `#include`/`#import` resolution, no `@preview` packages, no system fonts, no PDF export — those are a separate spec.

**Tech Stack:** Rust 2021 (`typst`, `typst-assets`), Tauri 2 (`#[tauri::command]` + `invoke`), vanilla TypeScript, vitest, cargo.

**Spec:** `docs/artifacts/specs/typst/2026-08-10-typst-single-file-preview-design.md` (read this first — it contains the four resolved brainstorm forks, the typst-vs-markdown delta table, the exact command/frontend contracts, the behavior matrix, the catalog-update table with the "no new permission" call-out, and the deferred-to-folder-mode list).

## Global Constraints

- **OS:** Windows + Linux. Editor buffer is always LF-normalized before reaching typst (AGENTS.md) — `SingleFileWorld::new(text)` can assume `\n`-only input.
- **No new `capabilities/default.json` permission** — `compile_typst` is compute-only (String in, strings out, no fs scope). If the implementer thinks one is needed, stop and re-check (spec §6).
- **typst version pin:** The `typst` crate's `World` trait + SVG emission API has shifted between minor versions. Task 1 Step 1 resolves and records the latest stable versions; Task 1 Step 2 reads the actual trait/API for those versions before writing any code. Do not pin to a version older than the latest stable without a recorded reason.
- **v1 boundary is non-negotiable:** Any non-root file/package lookup must surface as a clean typst compile error forwarded to the banner — never a panic, never silent. Spec §4.1, §9.
- **Test convention:** Pure-logic tests only in `src/__tests__/` (no Tauri IPC mocking, no CodeMirror mocking, no DOM mocking). Backend tests are inline `#[cfg(test)]` modules. (tabs spec §12, restore-on-launch spec §7.)
- **Verify before claiming done:** `npm test`, `npx tsc --noEmit`, `cargo test --manifest-path src-tauri/Cargo.toml` — all must pass. (AGENTS.md.)
- **Catalog rule (AGENTS.md):** A new Tauri command MUST land in both `main.rs invoke_handler![]` AND `src/fileio.ts`. The new file association MUST land in `tauri.conf.json`. Two catalogs disagreeing about the same item is a stop-and-fix red flag.
- **No commit/push without the plan carve-out:** This plan is approved spec/plan-driven work, so commit at task boundaries per AGENTS.md's carve-out. Branch from latest `main` (suggested `feat/typst-preview`). Do not push unless the user asks.
- **Ponytail:** Match the existing module style. No abstraction with one implementation; no scaffolding "for later". Inline styles for the error banner are acceptable (matches the no-CSS-file convention seen elsewhere in the codebase).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src-tauri/Cargo.toml` | Backend deps | **Modify** — add `typst`, `typst-assets` (`fonts` feature), and `typst-svg` if the pinned version splits SVG emission out of `typst`. |
| `src-tauri/src/typst_compile.rs` | `compile_typst` command + `SingleFileWorld` + inline tests | **Create.** |
| `src-tauri/src/main.rs` | Command registration | **Modify** — add `mod typst_compile;` and `typst_compile::compile_typst` to `invoke_handler![...]`. |
| `src/fileio.ts` | Frontend `invoke()` wrappers | **Modify** — add `TypstError`, `TypstResult` interfaces and `compileTypst(text)` wrapper. |
| `src/preview.ts` | Render-into-pane module | **Modify** — add `previewKind` state, `setPreviewKind`, race-guarded `renderTypstNow`, dispatch in `renderPreviewNow`, two debounce instances, error banner. |
| `src/main.ts` | Tab orchestration | **Modify** — add `isTypst()` predicate; rewrite `applyPreviewMode()` (spec §4.3); add `typ` + `typst` to `FILTERS`. |
| `src-tauri/tauri.conf.json` | OS file associations | **Modify** — add `.typ` + `.typst` to `bundle.fileAssociations`. |
| `src/__tests__/typst-preview.test.ts` | Frontend pure-logic tests | **Create.** Race guard token helper + path predicates. |
| `src-tauri/capabilities/default.json` | Permissions | **No change.** |
| `index.html` | Dialog markup | **No change** — error banner built from TS. |
| `package.json` | Frontend deps | **No change.** |
| `src/render.ts` | Markdown-only render | **No change** — typst does not go through `renderMarkdown`. |
| `src/menu.ts` | Menu setup | **No change.** |

---

## Task 1: Backend — `compile_typst` Tauri command + `SingleFileWorld`

**Files:**
- Modify: `src-tauri/Cargo.toml` (deps section, currently lines 9-16).
- Create: `src-tauri/src/typst_compile.rs`.
- Modify: `src-tauri/src/main.rs:3` (add `mod typst_compile;`) and `src-tauri/src/main.rs:31-35` (add to `invoke_handler![...]`).

**Interfaces:**
- Consumes: nothing from other tasks. Pure Rust.
- Produces (contract other tasks rely on):
  - `#[tauri::command] pub fn compile_typst(text: String) -> Result<TypstResult, String>`
  - `pub struct TypstResult { pub pages: Vec<String>, pub errors: Vec<TypstError> }`
  - `pub struct TypstError { pub message: String, pub line: Option<u32> }`
  - Semantics: `pages` empty iff `errors` non-empty. Outer `Err(String)` reserved for world-init panics only; typst compile failures are data inside `Ok(TypstResult)`.

**Context for the implementer (read spec §2, §3.1, §4.1, §9, §10):**

typst is not a markup→HTML pass like `marked()`. It is a real typesetter whose library entry point is `typst::compile(&world)` against a `World` trait. The trait surface and the SVG emission API have shifted across minor typst versions, so this task verifies the API for the resolved version before writing impl code. The v1 boundary is enforced at the `World` level: any non-root file lookup returns an error, so `#include`/`#import`/`@preview` all surface as clean compile errors (spec §9). The contract above is the hard surface — do not deviate; the frontend tests and smoke scenarios pin against it.

- [ ] **Step 1: Resolve and record the latest stable typst versions**

Run from `src-tauri/`:

```bash
cargo search typst --limit 1
cargo search typst-assets --limit 1
```

Record the resolved versions in the task report (e.g. `typst = "0.12.1"`, `typst-assets = "0.12.0"`). These are what Task 1 pins.

Add to `src-tauri/Cargo.toml` `[dependencies]` (keep alphabetical-ish with the existing entries):

```toml
typst = "<resolved-version>"
typst-assets = { version = "<resolved-version>", features = ["fonts"] }
```

(If Step 2 reveals SVG emission lives in a separate `typst-svg` crate for the resolved version, add it here too.)

- [ ] **Step 2: Verify the World trait + compile + SVG API for the pinned versions**

Fetch the resolved versions' docs and read the actual signatures. From `src-tauri/`:

```bash
cargo fetch
cargo doc --package typst --no-deps --open
```

(Or read `~/.cargo/registry/src/.../typst-<version>/src/` directly.) Confirm against the pinned source:

1. **`typst::World` trait methods** — list every method the trait requires (typically: `library`, `book`, `font`, `file`, `resolve`/`source`, `today`; some versions add `package`). Record the exact method signatures.
2. **`typst::compile` signature** — return type is `SourceResult<Document>` (= `Result<Document, EcoVec<SourceDiagnostic>>`) in recent versions. Confirm.
3. **SVG emission** — recent versions expose it as `typst::svg::svg(page)` or `typst::svg::svg_formatted(page, options)` from the `typst` crate (behind no separate feature flag) OR via a separate `typst-svg` crate. Confirm which.
4. **`Source` construction** — `Source::detached(text)` is the standard way to make a root source from a string. Confirm.
5. **`SourceDiagnostic`** — confirm how to extract the error message and the line number (via `.diag.message` and `.span` resolution against the world's source, or a traces helper). If line extraction is awkward in this version, fall back to `line: None` and surface just the message — do not block on pretty spans.

Record the verified API in the task report. **Do not proceed to Step 3 without this.**

- [ ] **Step 3: Write the failing tests first (TDD)**

Create `src-tauri/src/typst_compile.rs` with just the structs (so it compiles), an empty `compile_typst` stub returning `Err("not implemented".into())`, and the inline test module:

```rust
use serde::Serialize;

#[derive(Serialize)]
pub struct TypstError {
    pub message: String,
    pub line: Option<u32>,
}

#[derive(Serialize)]
pub struct TypstResult {
    pub pages: Vec<String>,
    pub errors: Vec<TypstError>,
}

#[tauri::command]
pub fn compile_typst(_text: String) -> Result<TypstResult, String> {
    Err("not implemented".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_trivial_doc() {
        let r = compile_typst("#set page(width: 40pt)\nHi".into()).unwrap();
        assert!(r.errors.is_empty(), "unexpected errors: {:?}", r.errors);
        assert!(r.pages.len() >= 1, "expected at least one page");
        assert!(r.pages[0].contains("<svg"), "page should be an SVG: {}", &r.pages[0][..r.pages[0].len().min(200)]);
    }

    #[test]
    fn returns_errors_for_broken_doc() {
        // malformed: width takes a value, not empty
        let r = compile_typst("#set page(width: )".into()).unwrap();
        assert!(r.pages.is_empty(), "expected no pages on compile error");
        assert!(!r.errors.is_empty(), "expected at least one error");
        // at least one error should carry a line if the pinned version exposes it
        // (don't assert line.is_some() hard — version-dependent)
    }

    #[test]
    fn include_is_clean_error_in_v1() {
        // v1 boundary (spec §9): file lookups are clean errors, not panics
        let r = compile_typst("#include \"other.typ\"".into()).unwrap();
        assert!(!r.errors.is_empty(), "expected #include to surface as an error");
        let combined: String = r.errors.iter().map(|e| e.message.clone()).collect::<Vec<_>>().join(" ");
        assert!(combined.to_lowercase().contains("other.typ"), "error should mention the missing file: {}", combined);
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 3 new tests FAIL (the first on `unwrap()` of `Err`, the others on the same). Existing `fs_cmds` tests still pass.

- [ ] **Step 5: Implement `SingleFileWorld` and `compile_typst`**

Replace the stub with a full implementation against the verified API. Skeleton (adapt method signatures to the pinned version from Step 2):

```rust
use serde::Serialize;
use std::sync::OnceLock;
use typst::World;

#[derive(Serialize)]
pub struct TypstError {
    pub message: String,
    pub line: Option<u32>,
}

#[derive(Serialize)]
pub struct TypstResult {
    pub pages: Vec<String>,
    pub errors: Vec<TypstError>,
}

struct SingleFileWorld {
    source: typst::syntax::Source,
}

impl SingleFileWorld {
    fn new(text: &str) -> Self {
        // klad's editor buffer is already LF-normalized (AGENTS.md); no CRLF here.
        Self { source: typst::syntax::Source::detached(text) }
    }
}

// Embedded font book + bytes: built once, reused across compiles.
// ponytail: static OnceLock rather than per-call init — font parsing is the heavy part.
fn fonts() -> &'static (typst::text::FontBook, Vec<typst::text::Font>) {
    static FONTS: OnceLock<(typst::text::FontBook, Vec<typst::text::Font>)> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut book = typst::text::FontBook::new();
        let mut fonts = Vec::new();
        for bytes in typst_assets::fonts() {
            let font = typst::text::Font::new(bytes.into(), 0).unwrap();
            book.push(font.info().clone());
            fonts.push(font);
        }
        (book, fonts)
    })
}

impl World for SingleFileWorld {
    // Fill in EVERY method required by the pinned trait version (from Step 2).
    // Contracts:
    //   library   -> default Library for the pinned version (typically `typst::Library::default()`)
    //   book      -> &fonts().0
    //   font(id)  -> fonts().1.get(id).cloned()  (Option<Font>)
    //   file(id)  -> Err for any id != root (v1 boundary — spec §9). Use the pinned
    //                version's expected error type (typically FileError::NotFound).
    //   source(id, _) -> if id == self.source.id() return Ok(self.source.clone()) else Err
    //   package(spec) -> Err (v1 boundary — no @preview fetch)
    //   today(None)   -> 25-character YYYY-MM-DD string of the system date (use the
    //                pinned version's preferred date path; chrono if transitively available,
    //                else a tiny manual formatter over SystemTime).
    //   // any other methods the pinned trait requires -> sensible default per docs
}

fn format_diag(d: &typst::diag::SourceDiagnostic) -> TypstError {
    // Extract message via d.diagnosis / d.message per the pinned API (Step 2 #5).
    // Extract line by resolving d.span against the world source if the API exposes it;
    // otherwise line: None.
    TypstError {
        message: /* format(d) */,
        line: /* resolve(d.span) */,
    }
}

#[tauri::command]
pub fn compile_typst(text: String) -> Result<TypstResult, String> {
    let world = SingleFileWorld::new(&text);
    match typst::compile(&world) {
        Ok(document) => {
            let pages: Vec<String> = document.pages
                .iter()
                .map(|page| /* svg emission call verified in Step 2 #3 */)
                .collect();
            Ok(TypstResult { pages, errors: vec![] })
        }
        Err(errs) => {
            let errors = errs.iter().map(format_diag).collect();
            Ok(TypstResult { pages: vec![], errors })
        }
    }
}

#[cfg(test)]
mod tests { /* unchanged from Step 3 */ }
```

Note: `#[tauri::command]` is invoked from the webview; sync is fine, Tauri runs commands on a thread pool by default (matches `fs_cmds.rs`). For SVG emission, prefer the single-page `svg(page)` form (not the multi-page bundled form) — we want one SVG per page so the frontend can stack them.

- [ ] **Step 6: Register the command in `main.rs`**

In `src-tauri/src/main.rs`:

After line 3 (`mod fs_cmds;`) add:
```rust
mod typst_compile;
```

In the `invoke_handler![...]` block (currently lines 31-35), add `typst_compile::compile_typst` as a new entry:
```rust
.invoke_handler(tauri::generate_handler![
    fs_cmds::read_file,
    fs_cmds::save_file,
    fs_cmds::get_startup_file,
    typst_compile::compile_typst
])
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass, 0 failed — the 3 new typst tests plus all existing `fs_cmds` tests. The `include_is_clean_error_in_v1` test is the v1 boundary guard; if it fails with a panic instead of a clean error, the `World` file/package resolver is returning the wrong thing — re-check Step 5 against the pinned API.

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: clean build (no warnings beyond pre-existing).

- [ ] **Step 8: Commit on the feature branch**

Ensure you're on a branch cut from latest `main` (e.g. `feat/typst-preview`). Stage and commit:

```bash
git status   # confirm branch
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/typst_compile.rs src-tauri/src/main.rs
git status   # confirm only these staged
git commit -m "feat(typst): add compile_typst Tauri command + SingleFileWorld

Add a new Tauri command compile_typst(text) -> TypstResult that compiles
a single in-memory typst source and returns one SVG string per page (or
formatted errors with line numbers). The SingleFileWorld implements
typst's World trait with the source from the editor buffer and fonts from
the embedded typst-assets crate; all file/package lookups return errors,
pinning v1 to single-file (no #include/#import, no @preview packages, no
system fonts). Registered in main.rs invoke_handler per AGENTS.md.

Three inline tests cover the trivial-doc happy path, the malformed-doc
error path, and the v1 boundary (#include surfaces as a clean error, not
a panic). The typst/typst-assets versions are pinned to the latest stable
resolved at task time; the World trait surface and SVG emission entry
point were verified against the pinned source before implementing."
```

(Do not push unless asked. AGENTS.md.)

---

## Task 2: Frontend — `compileTypst` wrapper + preview.ts dispatch + race guard

**Files:**
- Modify: `src/fileio.ts` (add wrapper + interfaces; current file is 57 lines, append after line 25 `getStartupFile`).
- Modify: `src/preview.ts` (substantial changes throughout; current file is 44 lines).
- Create: `src/__tests__/typst-preview.test.ts`.

**Interfaces:**
- Consumes:
  - `compile_typst` Tauri command (Task 1).
  - Existing `renderMarkdown(text)` from `src/render.ts` (unchanged).
  - Existing `invoke` from `@tauri-apps/api/core`.
- Produces:
  - `compileTypst(text: string): Promise<TypstResult>` from `src/fileio.ts`.
  - `setPreviewKind(kind: "md" | "typ"): void` from `src/preview.ts` — called by `main.ts` before render.
  - Existing exports `renderPreviewNow`, `updatePreview`, `setPreviewVisible`, `isPreviewVisible`, `syncPreviewScroll` keep their signatures.
  - Race-guard helper exposed for testing: `pickRender(currentToken: number, latestToken: () => number): boolean` — pure, returns `currentToken === latestToken()`.

**Context for the implementer (read spec §3.2, §4.2, §7.2):**

`renderPreviewNow(text)` is **sync today**. Adding typst makes the typ branch **async** (Tauri invoke). On fast typing this means multiple compiles can be in flight; the latest one must win, and a stale slow one must **not** overwrite a newer render. The race guard is the single correctness-critical piece of new frontend logic — a monotonic render token, captured per call, checked on resolve. The token check must be unit-tested directly (project convention: pure-logic tests only, no DOM mocking — so extract the decision into a pure helper).

The error banner is built from TS (no `index.html` change, spec §6) and attached to the pane's parent. On error, the last-good SVG stays in the pane; only the banner shows/hides.

- [ ] **Step 1: Write the failing tests first (TDD)**

Create `src/__tests__/typst-preview.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

// Pure helpers extracted from preview.ts so the race-guard and kind-dispatch
// logic can be tested without DOM or Tauri IPC (project convention: pure-logic only).

// Re-implemented locally here for the test; the real one lives in preview.ts.
// The contract under test: a stale token never wins.
function pickRender(currentToken: number, latestToken: number): boolean {
  return currentToken === latestToken;
}

describe("typst render race guard", () => {
  it("applies when the token is still the latest", () => {
    expect(pickRender(5, 5)).toBe(true);
  });

  it("drops when a newer render has started", () => {
    expect(pickRender(5, 7)).toBe(false);
  });

  it("drops when interleaved out of order (slow then fast)", () => {
    // Simulate: token 1 starts (slow), token 2 starts+finishes fast (latest=2),
    // then token 1's result arrives — must drop.
    const slowToken = 1;
    const latestAfterFast = 2;
    expect(pickRender(slowToken, latestAfterFast)).toBe(false);
  });
});

// Pure kind derivation from a path (mirrors src/main.ts isMarkdown/isTypst).
function previewKindForPath(path: string | null): "md" | "typ" | null {
  if (/\.(md|markdown)$/i.test(path ?? "")) return "md";
  if (/\.(typ|typst)$/i.test(path ?? "")) return "typ";
  return null;
}

describe("previewKindForPath", () => {
  it("detects markdown", () => {
    expect(previewKindForPath("foo.md")).toBe("md");
    expect(previewKindForPath("foo.markdown")).toBe("md");
    expect(previewKindForPath("foo.MD")).toBe("md"); // case-insensitive
  });

  it("detects typst", () => {
    expect(previewKindForPath("foo.typ")).toBe("typ");
    expect(previewKindForPath("foo.typst")).toBe("typ");
    expect(previewKindForPath("foo.TYP")).toBe("typ"); // case-insensitive
  });

  it("returns null for non-previewable files", () => {
    expect(previewKindForPath("foo.txt")).toBeNull();
    expect(previewKindForPath("foo.log")).toBeNull();
    expect(previewKindForPath(null)).toBeNull();
    expect(previewKindForPath("")).toBeNull();
  });

  it("does not confuse .typst with other dotfiles", () => {
    expect(previewKindForPath("foo.typst.bak")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- typst-preview`
Expected: FAIL (`vitest` runs but no `previewKindForPath` import resolves yet — or the file's local copies pass trivially; in that case, see Step 4 which moves them into preview.ts and re-imports).

(Note: the test file as written above contains local copies of the helpers and would technically pass against itself. The intent is to lock the *contract*. Step 4 replaces the local copies with imports from `preview.ts`, at which point the tests pin real code. If you prefer strict TDD red-green, move the helpers into `preview.ts` first, then write tests that import them, then run to red on missing exports. Either order is acceptable; the contract is what matters.)

- [ ] **Step 3: Add `compileTypst` wrapper to `src/fileio.ts`**

In `src/fileio.ts`, after `getStartupFile` (currently line 25), add:

```typescript
export interface TypstError {
  message: string;
  line?: number | null;
}

export interface TypstResult {
  pages: string[];
  errors: TypstError[];
}

export function compileTypst(text: string): Promise<TypstResult> {
  return invoke<TypstResult>("compile_typst", { text });
}
```

- [ ] **Step 4: Extend `src/preview.ts` with kind dispatch, race guard, and error banner**

Replace the entire contents of `src/preview.ts` with:

```typescript
import { renderMarkdown } from "./render";
import { compileTypst, type TypstError, type TypstResult } from "./fileio";

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function pane(): HTMLElement {
  return document.getElementById("preview")!;
}

// --- preview-kind state ---------------------------------------------------

export type PreviewKind = "md" | "typ";
let previewKind: PreviewKind = "md";

export function setPreviewKind(kind: PreviewKind): void {
  previewKind = kind;
}

// --- visibility -----------------------------------------------------------

let visible = false;

export function isPreviewVisible(): boolean {
  return visible;
}

export function setPreviewVisible(on: boolean): void {
  visible = on;
  pane().hidden = !on;
  if (!on) hideErrorBanner();
}

// --- race guard (spec §4.2) ----------------------------------------------
// Pure helper exported for testing. A stale compile (older token) must not
// overwrite the pane after a newer compile has already applied.
export function pickRender(currentToken: number, latestToken: number): boolean {
  return currentToken === latestToken;
}

let renderToken = 0;

// --- error banner (built from TS; no index.html change) ------------------

let errorBanner: HTMLDivElement | null = null;

function errorBannerEl(): HTMLDivElement {
  if (errorBanner) return errorBanner;
  const el = document.createElement("div");
  el.id = "preview-error";
  // ponytail: inline styles — klad has no CSS file for plugin chrome; matches
  // the dialog style precedent. Upgrade to a class if a stylesheet lands.
  el.style.color = "#b00";
  el.style.background = "#fde8e8";
  el.style.borderBottom = "1px solid #f0c0c0";
  el.style.padding = "4px 8px";
  el.style.fontFamily = "var(--editor-font-family, monospace)";
  el.style.fontSize = "12px";
  el.style.whiteSpace = "pre-wrap";
  el.hidden = true;
  pane().parentElement?.prepend(el);
  errorBanner = el;
  return el;
}

function showErrorBanner(e: TypstError): void {
  const el = errorBannerEl();
  el.textContent = e.line != null ? `line ${e.line}: ${e.message}` : e.message;
  el.hidden = false;
}

function hideErrorBanner(): void {
  if (errorBanner) errorBanner.hidden = true;
}

// --- render paths ---------------------------------------------------------

function applyTypstResult(result: TypstResult): void {
  if (result.errors.length > 0) {
    showErrorBanner(result.errors[0]!);
    return; // keep last-good pane contents
  }
  hideErrorBanner();
  pane().innerHTML = result.pages.map((svg) => `<div class="typst-page">${svg}</div>`).join("");
}

async function renderTypstNow(text: string): Promise<void> {
  const token = ++renderToken;
  const result = await compileTypst(text);
  if (!pickRender(token, renderToken)) return; // stale; a newer render is in flight
  applyTypstResult(result);
}

export function renderPreviewNow(text: string): void {
  if (!visible) return;
  if (previewKind === "typ") {
    void renderTypstNow(text); // fire-and-forget; race-guarded internally
    return;
  }
  pane().innerHTML = renderMarkdown(text);
}

const updatePreviewMd = debounce(renderPreviewNow, 150);
const updatePreviewTyp = debounce(renderPreviewNow, 400);

export function updatePreview(text: string): void {
  if (previewKind === "typ") updatePreviewTyp(text);
  else updatePreviewMd(text);
}

export function syncPreviewScroll(scroller: HTMLElement): void {
  // ponytail: proportional scroll sync; upgrade to heading-anchor mapping if drift annoys
  const p = pane();
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (max <= 0) return;
  const ratio = scroller.scrollTop / max;
  const previewMax = p.scrollHeight - p.clientHeight;
  if (previewMax <= 0) return;
  p.scrollTop = ratio * previewMax;
}
```

- [ ] **Step 5: Re-run tests to verify they pass against real code**

Update `src/__tests__/typst-preview.test.ts` to import the helpers from `preview.ts` instead of using local copies. Replace the two local helper definitions with imports:

```typescript
import { describe, it, expect } from "vitest";
import { pickRender } from "../preview";

// previewKindForPath stays local here (it mirrors src/main.ts's isMarkdown/isTypst
// derivation; main.ts doesn't export it). The contract under test is the derivation.
function previewKindForPath(path: string | null): "md" | "typ" | null {
  if (/\.(md|markdown)$/i.test(path ?? "")) return "md";
  if (/\.(typ|typst)$/i.test(path ?? "")) return "typ";
  return null;
}

describe("typst render race guard", () => {
  it("applies when the token is still the latest", () => {
    expect(pickRender(5, 5)).toBe(true);
  });
  it("drops when a newer render has started", () => {
    expect(pickRender(5, 7)).toBe(false);
  });
  it("drops when interleaved out of order (slow then fast)", () => {
    expect(pickRender(1, 2)).toBe(false);
  });
});

describe("previewKindForPath", () => {
  it("detects markdown", () => {
    expect(previewKindForPath("foo.md")).toBe("md");
    expect(previewKindForPath("foo.markdown")).toBe("md");
    expect(previewKindForPath("foo.MD")).toBe("md");
  });
  it("detects typst", () => {
    expect(previewKindForPath("foo.typ")).toBe("typ");
    expect(previewKindForPath("foo.typst")).toBe("typ");
    expect(previewKindForPath("foo.TYP")).toBe("typ");
  });
  it("returns null for non-previewable files", () => {
    expect(previewKindForPath("foo.txt")).toBeNull();
    expect(previewKindForPath("foo.log")).toBeNull();
    expect(previewKindForPath(null)).toBeNull();
    expect(previewKindForPath("")).toBeNull();
  });
  it("does not confuse .typst.bak with .typst", () => {
    expect(previewKindForPath("foo.typst.bak")).toBeNull();
  });
});
```

Run: `npm test`
Expected: all tests pass, 0 failed — the new typst-preview tests plus the existing session/tabs/singleinstance tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add src/fileio.ts src/preview.ts src/__tests__/typst-preview.test.ts
git status   # confirm only these staged
git commit -m "feat(preview): add typst kind dispatch with race-guarded async render

preview.ts learns a previewKind state ('md' | 'typ') set via setPreviewKind
by main.ts's applyPreviewMode. The 'typ' branch fires an async compileTypst
IPC and applies the per-page SVGs (or shows a red banner above the pane
with the first error, keeping the last-good render). A monotonic render
token guards against stale compiles overwriting newer renders on fast
typing — the only correctness-critical piece of new logic. Two debounce
instances preserve markdown's 150ms while typst uses 400ms.

fileio.ts adds the compileTypst wrapper (mirrors the existing invoke()
pattern) and the TypstResult/TypstError interfaces. Adds vitest tests for
the race guard and the path-to-kind derivation (pure-logic only, per
project convention — no DOM or Tauri IPC mocking). No index.html or
capabilities change; the banner is built from TS."
```

---

## Task 3: Wire `applyPreviewMode` + file filters + `.typ`/`.typst` association + smoke

**Files:**
- Modify: `src/main.ts:13-19` (import `setPreviewKind`), `src/main.ts:34-37` (`FILTERS`), `src/main.ts:177-186` (`isMarkdown` neighbor + `applyPreviewMode` rewrite).
- Modify: `src-tauri/tauri.conf.json:36-42` (add to `bundle.fileAssociations`).

**Interfaces:**
- Consumes:
  - `setPreviewKind(kind)` from `src/preview.ts` (Task 2).
  - `compile_typst` command working end-to-end (Task 1).
- Produces: the user-visible feature. Open a `.typ` file → preview renders typst pages; edit → live update.

**Context for the implementer (read spec §3.3, §4.3, §5, §7.3):**

`applyPreviewMode()` in `main.ts:181-186` currently does a markdown-only check and toggles the pane. It needs to compute the kind from the active tab's path, push that into preview.ts via `setPreviewKind`, and dispatch the right render. `FILTERS` at `main.ts:34-37` controls the Open dialog's "Text files" extension list — add `typ` and `typst`. The Tauri `bundle.fileAssociations` at `tauri.conf.json:36-42` controls OS-level double-click handling on Windows + Linux.

- [ ] **Step 1: Import `setPreviewKind` in `main.ts`**

In `src/main.ts`, the existing preview import block is lines 13-19:

```typescript
import {
  isPreviewVisible,
  renderPreviewNow,
  setPreviewVisible,
  syncPreviewScroll,
  updatePreview,
} from "./preview";
```

Add `setPreviewKind` to that import list (alphabetical-ish within the block):

```typescript
import {
  isPreviewVisible,
  renderPreviewNow,
  setPreviewKind,
  setPreviewVisible,
  syncPreviewScroll,
  updatePreview,
} from "./preview";
```

- [ ] **Step 2: Add `typ`/`typst` to `FILTERS`**

In `src/main.ts:34-37`, the `FILTERS` const is:

```typescript
const FILTERS = [
  { name: "Text files", extensions: ["txt", "md", "markdown", "log", "ini", "cfg"] },
  { name: "All files", extensions: ["*"] },
];
```

Replace with:

```typescript
const FILTERS = [
  { name: "Text files", extensions: ["txt", "md", "markdown", "log", "ini", "cfg", "typ", "typst"] },
  { name: "All files", extensions: ["*"] },
];
```

- [ ] **Step 3: Add `isTypst` predicate and rewrite `applyPreviewMode`**

In `src/main.ts`, the current `isMarkdown` + `applyPreviewMode` block is lines 177-186:

```typescript
function isMarkdown(m: DocMeta): boolean {
  return /\.(md|markdown)$/i.test(m.path ?? "");
}

function applyPreviewMode(): void {
  const on = isMarkdown(meta);
  setPreviewVisible(on);
  if (on) renderPreviewNow(getText(activeTab().view));
  void menuHandles?.previewItem.setChecked(on);
}
```

Replace with:

```typescript
function isMarkdown(m: DocMeta): boolean {
  return /\.(md|markdown)$/i.test(m.path ?? "");
}

function isTypst(m: DocMeta): boolean {
  return /\.(typ|typst)$/i.test(m.path ?? "");
}

function applyPreviewMode(): void {
  const kind: "md" | "typ" | null = isMarkdown(meta) ? "md" : isTypst(meta) ? "typ" : null;
  setPreviewVisible(kind !== null);
  // setPreviewKind must run before renderPreviewNow so the sync 'md' branch
  // dispatches correctly. For 'typ' the kind is read inside the async branch.
  setPreviewKind(kind === "typ" ? "typ" : "md");
  if (kind) renderPreviewNow(getText(activeTab().view));
  void menuHandles?.previewItem.setChecked(kind !== null);
}
```

Leave every other call site of `applyPreviewMode` (tab switch, save-as, close-tab, etc.) untouched — they call `applyPreviewMode()` which now does the right thing per kind.

- [ ] **Step 4: Add `.typ`/`.typst` file association in `tauri.conf.json`**

In `src-tauri/tauri.conf.json`, the `bundle.fileAssociations` array is currently lines 36-42. Add a new entry at the end:

```json
"fileAssociations": [
  { "ext": ["txt"], "name": "Text Document", "description": "Text Document", "mimeType": "text/plain", "role": "Editor" },
  { "ext": ["md", "markdown"], "name": "Markdown Document", "description": "Markdown Document", "mimeType": "text/markdown", "role": "Editor" },
  { "ext": ["log"], "name": "Log File", "description": "Log File", "mimeType": "text/plain", "role": "Editor" },
  { "ext": ["ini"], "name": "Configuration File", "description": "Configuration File", "mimeType": "text/plain", "role": "Editor" },
  { "ext": ["cfg"], "name": "Configuration File", "description": "Configuration File", "mimeType": "text/plain", "role": "Editor" },
  { "ext": ["typ", "typst"], "name": "Typst Document", "description": "Typst Document", "mimeType": "text/x-typst", "role": "Editor" }
]
```

- [ ] **Step 5: Typecheck + run all automated tests**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npm test`
Expected: all pass, 0 failed (Task 2 tests + existing suite).

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 0 failed (Task 1 tests + existing fs_cmds).

- [ ] **Step 6: Manual smoke test (acceptance — spec §7.3)**

Build the dev app and walk the scenarios. From repo root:

```bash
npm run tauri dev
```

Prep: create test files in `C:\Users\ruben\AppData\Local\Temp\opencode\` (pre-approved external dir):
- `typst-smoke.typ` containing:
  ```
  #set page(width: 200pt)
  Hello #emph[typst].

  = Heading
  Some body text.
  ```

Walk each scenario. All must pass.

1. **Open `.typ` → renders:** Drag `typst-smoke.typ` onto the klad window (or use `Ctrl+O`). Preview pane shows 1 SVG page with the rendered text + italic + heading. No error banner.
2. **Live keystroke:** Append `\n\n#image("missing.png")` — within ~400ms the error banner appears mentioning the missing file. Delete the line — banner disappears, fresh render replaces.
3. **Last-good stays on error:** From the rendered state, type `#set page(width: )` — the **last good SVG stays on screen**, the banner shows the parse error with a line number. Fix the source — banner hides, fresh render.
4. **v1 boundary — `#include` is a clean error:** Set the buffer to `#include "other.typ"`. Banner mentions the missing file. **No crash, no panic.**
5. **Race guard on fast typing:** Hold down a key for several seconds (repeat) in a doc that compiles cleanly. The pane should not flicker between stale and fresh renders — the latest compile wins each time. (Visual check; the unit test in Task 2 pins the contract.)
6. **Tab switch md ↔ typ:** Open `typst-smoke.typ` and an `.md` file. Switch tabs — the pane re-renders with the right kind each direction. No stale cross-kind content; banner from a typ error in tab A does not persist when switching to the md tab.
7. **Tab switch typ → txt:** Open a `.txt` file. Preview hides. Switch back to `.typ` — preview re-shows and re-renders.
8. **Open dialog filter:** `Ctrl+O` → the "Text files" filter entry shows `*.txt;*.md;...;*.typ;*.typst` in the file picker.
9. **Linux smoke (if available):** Same 1-7 on the deb/appimage build. (Skip if no Linux environment in this session; record in the task report.)

If any scenario fails, **do not commit** — re-read spec §3.2, §4.2 (race guard), §5 (behavior matrix), and the relevant task; confirm the edit matches the step verbatim; confirm `compile_typst` is registered in `main.rs invoke_handler![]` AND exposed via `compileTypst` in `fileio.ts` (catalog rule).

- [ ] **Step 7: Commit**

```bash
git add src/main.ts src-tauri/tauri.conf.json
git status   # confirm only these staged
git commit -m "feat(typst): wire applyPreviewMode + .typ/.typst file association

applyPreviewMode now derives the preview kind ('md' | 'typ' | null) from
the active tab's path, pushes it into preview.ts via setPreviewKind, and
dispatches the right render. Adds an isTypst predicate alongside the
existing isMarkdown. The Open dialog's 'Text files' filter and the OS
file associations (tauri.conf.json bundle.fileAssociations) both gain
.typ and .typst so the Open dialog shows them and double-clicking a
.typ file launches klad with preview enabled. No capabilities change
(compile_typst is compute-only). No index.html change (banner is TS-built)."
```

---

## Self-Review (run after writing, before dispatch)

- [x] **Spec coverage:**
  - Spec §1 (problem, four brainstorm forks) → Global Constraints (v1 boundary, version pin) + Task 1 (Rust backend) + Task 3 (file assoc + wiring). PDF export / folder mode are explicitly NOT here (deferred, spec §9).
  - Spec §2 (typst vs marked delta table) → Task 1 Context (real typesetter) + Task 2 Context (sync → async + race guard).
  - Spec §3.1 (backend module, command shape, World contracts, error formatting) → Task 1 in full.
  - Spec §3.2 (frontend kind dispatch, debounce split, banner) → Task 2 Step 4 verbatim.
  - Spec §3.3 (file-type detection, FILTERS, tauri.conf.json) → Task 3 Steps 2, 3, 4.
  - Spec §4.1 (command contract) → Task 1 Steps 3, 5 verbatim (structs + command shape).
  - Spec §4.2 (race guard exact code) → Task 2 Step 4 verbatim (`renderTypstNow` + `pickRender`).
  - Spec §4.3 (`applyPreviewMode` rewrite) → Task 3 Step 3 verbatim.
  - Spec §5 (behavior matrix) → Task 3 Step 6 scenarios 1-7 cover all rows.
  - Spec §6 (catalog table) → File Structure table + Global Constraints "no capabilities change" call-out. Every "Yes" in the spec table has a task; every "No" is called out as untouched.
  - Spec §7.1 (backend tests) → Task 1 Step 3 (three inline tests verbatim).
  - Spec §7.2 (frontend tests) → Task 2 Steps 1, 5 (race guard + predicate tests verbatim).
  - Spec §7.3 (manual smoke) → Task 3 Step 6 (scenarios 1-9).
  - Spec §8 (resolved decisions) → reflected throughout (kind dispatch in preview.ts, SVG output, embedded fonts, manual error format, last-good + banner, race guard, no new permission).
  - Spec §9 (deferred) → explicitly absent from all tasks; called out in Global Constraints "v1 boundary is non-negotiable".
  - Spec §10 (version pin) → Task 1 Steps 1, 2 (resolve + verify-gate).
  All spec sections mapped.

- [x] **Placeholder scan:** No TBD/TODO/"add error handling"/"similar to". Task 1 Step 5 has two `/* ... */` comment placeholders inside the code skeleton (`format_diag`, SVG emission call) — these are **deliberate**: the exact calls depend on the typst version verified in Step 2, and the skeleton gives the implementer the surrounding contract while pointing to Step 2's recorded API. The structs, command shape, test code, frontend code, main.ts rewrite, and tauri.conf.json entry are all complete verbatim. Smoke scenarios use concrete file paths and content.

- [x] **Type consistency:**
  - `TypstResult` / `TypstError` defined in Rust (Task 1 Step 3) and mirrored in TS (Task 2 Step 3) — fields match: `pages: Vec<String>` ↔ `pages: string[]`, `errors: Vec<TypstError>` ↔ `errors: TypstError[]`, `message: String` ↔ `message: string`, `line: Option<u32>` ↔ `line?: number | null` (serde emits `null` for `None`, optional in TS covers both undefined and null).
  - `compileTypst(text: string): Promise<TypstResult>` in fileio.ts ↔ `compile_typst(text: String) -> Result<TypstResult, String>` in Rust. Tauri unwraps the outer `Result`; the frontend sees `TypstResult` on success, rejects the promise on `Err(String)`. The `void renderTypstNow(text)` call in preview.ts handles rejection implicitly (would surface as unhandled rejection — acceptable for v1; folder mode will add error UI for transport failures).
  - `setPreviewKind(kind: "md" | "typ"): void` exported from preview.ts ↔ called in main.ts Step 3 with `kind === "typ" ? "typ" : "md"`.
  - `pickRender(currentToken: number, latestToken: number): boolean` exported from preview.ts ↔ imported in test file Task 2 Step 5.
  - `PreviewKind` type exported for testability (not strictly required, but used in the type signature of `setPreviewKind`).
  All names match across tasks.

## Execution Handoff

Plan complete and saved to `docs/artifacts/plans/typst/2026-08-10-typst-single-file-preview-plan.md`. Dispatching the orchestrator to execute all three tasks on a `feat/typst-preview` branch (single-pass, no approval gates per the planner pipeline; oracle on two-strike failures).
