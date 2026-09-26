# Typst Package Support (local + @preview) — Design

**Status:** approved (approach confirmed by user 2026-09-26)
**Feature dir:** `docs/artifacts/features/typst-packages/`
**Prior art:** `docs/artifacts/features/typst/2026-08-10-typst-single-file-preview-design.md` (deferred this exact feature, §future work)

## 1. Problem

Klad's live Typst preview compiles a single in-memory source (`SingleFileWorld`, `src-tauri/src/typst_compile.rs`). Every non-main lookup — including package imports — returns `FileError::NotFound`. So:

```typst
#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge
```

fails today. Users expect typst CLI semantics: `@preview` packages fetched from packages.typst.org into a local cache, and local packages from the OS data dir (ref: typst/packages README "Local packages").

## 2. Goals

1. `#import "@preview/<name>:<version>"` works in the live preview: resolved from local package dirs, then the on-disk cache, then downloaded once from packages.typst.org and cached.
2. Local packages work: any namespace (typst convention: `@local`, plus custom namespaces) resolved from the standard package data dir — Linux `$XDG_DATA_HOME/typst/packages` else `~/.local/share/typst/packages` (single path via `dirs::data_dir()`, no `$XDG_DATA_DIRS` multi-search), Windows `%APPDATA%\typst\packages`.
3. Download cache is the same directory the typst CLI uses (Linux `~/.cache/typst/packages`, Windows cache dir equivalent), so CLI and klad share packages.
4. Failures surface as clean typst compile errors in the existing preview banner — never a panic, never a hang past the request.
5. Zero frontend changes.

## 3. Non-goals (YAGNI)

- Project/folder mode: relative `#include`/`#import` of files next to the open document stays a clean error (unchanged v1 boundary for project files).
- Package management UI, settings toggles for network, cache clearing.
- In-memory package caching across keystrokes (disk reads per lookup are fine; revisit only if preview feels slow — `ponytail:` comment at the lookup site).
- Download progress UX; first compile with a new package blocks until download completes.
- PDF export, system fonts.

## 4. Approach (resolved fork)

**A. typst-kit — chosen** (user-confirmed). Add `typst-kit` 0.15.1 with features enabling local package dirs, universe (@preview) downloads, and the system downloader. Rejected: hand-rolled downloader (same dep weight, ~150 lines re-implementing upstream); local-dirs-only (fails the stated `@preview` ask).

Notable: typst 0.15 removed the old `PackageStorage`; typst-kit 0.15 exposes `packages` (`SystemPackages`, `UniversePackages`) and `downloader` (`SystemDownloader`) modules behind opt-in features. **Exact API shape (constructors, injectability, trait bindings) is resolved against the vendored registry source in plan Task 1 — this spec pins behavior, not typst-kit internals.**

## 5. Design

### 5.1 Backend wiring

- `src-tauri/Cargo.toml`: add
  ```toml
  typst-kit = { version = "0.15.1", features = ["system-packages", "universe-packages", "system-downloader"] }
  ```
  Do **not** enable `embedded-fonts` (klad already uses `typst-assets`) or `scan-fonts`.   Record the resulting new transitive deps (expected: `ureq`, `tar`, `flate2`, `native-tls`, `openssl`) in the task report. typst-kit 0.15.1 has **no rustls knob** — `system-downloader` hard-depends on native-tls/openssl on Linux (same dependency graph the typst CLI ships); accepted. Escape hatch if the build breaks: `vendor-openssl` feature.
- `src-tauri/src/typst_compile.rs` (or a new `src-tauri/src/typst_packages.rs` if that keeps files focused — implementer's call):
  - `SingleFileWorld` gains a package resolver field (typst-kit types or a thin struct over them).
  - `source(id)` / `file(id)`: branch on `id.root()`:
    - `VirtualRoot::Project` + main id → editor source (unchanged).
    - `VirtualRoot::Package(spec)` → resolve spec to a package directory (local dirs → cache dir → download-and-extract for `@preview`), then read the id's vpath inside it. `source()` returns `Source::new(id, text)` so spans resolve; `file()` returns raw bytes (for package assets like images).
    - Resolution failure (not found anywhere, network down, offline) → `FileError::NotFound`/`FileError::Other` with the package name in the message → existing `format_diag` → banner.
  - Relative project-file lookups keep returning `NotFound` (unchanged).
  - `compile_typst` becomes `#[tauri::command(async)]` with an unchanged sync body: plain sync commands run inline on the IPC/main thread in Tauri 2 (would freeze the window during a download); `async` moves the same code to the blocking threadpool. Frontend `invoke` contract unchanged. First-compile latency on a new package = download time; subsequent compiles hit disk cache.

### 5.2 Resolution order (behavior contract)

| Import | Order | All-miss behavior |
|---|---|---|
| `@preview/name:ver` | package data dirs → cache dir → download packages.typst.org → extract to cache | clean compile error naming the package |
| `@local/name:ver` (any non-preview namespace) | package data dirs only | clean compile error |
| relative `"file.typ"` / `"img.png"` | — (unchanged v1 boundary) | clean compile error |

Exact per-directory semantics (dir layout `<data>/typst/packages/<namespace>/<name>/<version>/`, `typst.toml` manifest) follow typst-kit / typst CLI; klad adds no custom search paths and no settings.

### 5.3 Frontend

None. Command signature `compile_typst(text) -> TypstResult` unchanged; `src/fileio.ts`, `src/preview.ts`, error banner untouched.

## 6. Catalog updates (AGENTS.md "Adding features")

| Catalog | Change |
|---|---|
| `src-tauri/Cargo.toml` + `Cargo.lock` | add `typst-kit` (+ transitive) |
| `src-tauri/src/main.rs` | none — no new command |
| `src-tauri/tauri.conf.json` | none — no file association change |
| `src-tauri/capabilities/default.json` | none — native HTTP from Rust backend, no new IPC scope/permission |
| `package.json` | none — no npm dep |
| `index.html` | none — no new dialog |
| `README.md` | update Typst preview limitations: packages now supported |
| `CHANGELOG.md` | `[Unreleased]` → `Added` entry |

## 7. Error handling

- Missing package / bad version / offline: compile error via existing banner; message includes namespace/name/version.
- Download or tarball failure: compile error, cache dir left without a partial entry (typst-kit semantics).
- Package file missing inside a resolved package: `FileError::NotFound` for the vpath.
- Malicious tarball paths (zip-slip): typst-kit's extractor (same as CLI) — klad adds no extraction code.
- Only the `preview` namespace is downloadable; no arbitrary-namespace fetch.

## 8. Testing

- Rust inline (`src-tauri`):
  - `@local` import compiles: fixture package (`typst.toml` + `lib.typ` or `src/lib.typ` entry) created in a temp package dir injected into the resolver; assert rendered output present, no errors. Requires the resolver's search paths to be injectable — if typst-kit constructors aren't injectable, wrap the lookup in a klad-owned struct whose paths are settable for tests (only then; no speculative trait).
  - `@preview`-style missing package (unresolvable namespace/name) → clean error, no panic (extends the existing `include_is_clean_error_in_v1` pattern).
  - Existing tests unchanged: `compiles_trivial_doc`, `returns_errors_for_broken_doc`, `include_is_clean_error_in_v1`.
  - Network download itself is **not** tested in CI (no network in test env); covered by manual smoke.
- Manual smoke: `#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge` + a minimal fletcher diagram renders; second keystroke is fast (cache).
- `cargo test` green; `npm test` untouched-green.

## 9. Versioning / release

Versioned project (canonical `src-tauri/tauri.conf.json` → `0.5.0`). Per project policy release cutting is deliberate: **no version bump in this feature; CHANGELOG `[Unreleased]` entry only.** Feature is `Added` → minor (0.6.0) whenever the user cuts the release.

## 10. Risks

- typst-kit 0.15 API differs from assumed shape → mitigated by Task 1 verify-against-source step (same pattern as the original typst plan).
- TLS backend pulls system OpenSSL on Linux → resolved: no rustls option in typst-kit 0.15.1; same graph as typst CLI; `vendor-openssl` escape hatch.
- Blocking download → moved off the main thread via `#[tauri::command(async)]` (threadpool); UI stays responsive.
