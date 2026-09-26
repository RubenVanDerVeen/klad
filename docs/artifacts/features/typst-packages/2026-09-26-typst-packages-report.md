# Typst Package Support — Execution Report

- **Date:** 2026-09-26
- **Branch:** `feat/typst-packages` (cut from `main` at `bf27e3c`, 4 commits)
- **Status:** **DONE — code + unit tests green on both sides; manual smoke NOT VERIFIED in this headless environment (blocking on user, pre-merge)**
- **Spec:** [`2026-09-26-typst-packages-design.md`](2026-09-26-typst-packages-design.md)
- **Plan:** [`2026-09-26-typst-packages-plan.md`](2026-09-26-typst-packages-plan.md)

## Summary

Klad's live Typst preview gains package resolution: `#import "@preview/<name>:<version>"` now works — resolved from local package data dirs, then the on-disk cache, then downloaded once from packages.typst.org and cached in the same directory the typst CLI uses (Linux `~/.cache/typst/packages`). Local packages (any namespace, e.g. `@local`) resolve from the standard typst package data dir. All failures surface as clean compile errors in the existing preview banner. Implementation is `typst-kit` 0.15.1 (`system-packages`, `universe-packages`, `system-downloader` features) wired into `SingleFileWorld` in `src-tauri/src/typst_compile.rs`. Zero frontend changes: command signature, `fileio.ts`, `preview.ts`, error banner untouched.

## Branch and commits

| SHA | Type | Scope | Subject |
|---|---|---|---|
| `a8f42ca` | docs | typst-packages | add approved design and implementation plan |
| `530f2d0` | feat | typst | resolve @preview and local packages in live preview (Task 1) |
| `e1d8ec4` | docs | typst | document package support in live preview (Task 2) |
| `dcede23` | chore | typst | tidy new test and format long `system_packages` call (post-review quick-fixes) |

Branch base: `main` (`bf27e3c`). Linear history. Oldest-first. Close-out adds only this report commit.

## Files changed (diff stats, `main..feat/typst-packages`)

```
 CHANGELOG.md                                                                    |   3 +
 README.md                                                                       |   2 +-
 docs/artifacts/features/typst-packages/2026-09-26-typst-packages-design.md      | 110 +++++++
 docs/artifacts/features/typst-packages/2026-09-26-typst-packages-plan.md        | 365 +++++++++++++++++++++
 src-tauri/Cargo.lock                                                            | 202 +++++++++++-
 src-tauri/Cargo.toml                                                            |   1 +
 src-tauri/src/typst_compile.rs                                                  | 155 ++++++++-
 7 files changed, 821 insertions(+), 17 deletions(-)
```

Scope discipline confirmed: no `main.rs`, `tauri.conf.json`, `capabilities/default.json`, `package.json`, `index.html`, no `src/**`, no version fields — exactly the catalog-update "none" column of spec §6. `typst-kit` is cataloged in the declared dependency catalog (`src-tauri/Cargo.toml:21` + lock).

## Per-task status

| Task | Commit | Dispatcher chain | Outcome |
|---|---|---|---|
| T1: backend package resolution + tests | `530f2d0` | executor + reviewer | **PASS** |
| T2: docs catalogs (`CHANGELOG`, `README`) + scope check | `e1d8ec4` | executor + reviewer | **PASS** |
| Standardizer quick-fixes | `dcede23` | executor + reviewer | **PASS** |

### Task 1 verification

- `cargo build` (`src-tauri/`): clean, no warnings. Build succeeded without the `vendor-openssl` escape hatch.
- `cargo test` (`src-tauri/`): **17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s** — 3 pre-existing typst tests (`compiles_trivial_doc`, `returns_errors_for_broken_doc`, `include_is_clean_error_in_v1`), **2 new tests** (`imports_local_package`, `missing_package_is_clean_error`), 12 other pre-existing crate tests.
- `npm test`: **Test Files 13 passed (13); Tests 102 passed (102)**.
- **Transitive deps locked** by `typst-kit = { 0.15.1, features = ["system-packages", "universe-packages", "system-downloader"] }` (from `git diff src-tauri/Cargo.lock | grep '+name'`):
  `env_proxy, filetime, foreign-types, foreign-types-shared, native-tls, openssl, openssl-macros, openssl-probe, openssl-sys, schannel, security-framework, security-framework-sys, tar, typst-kit, ureq, vcpkg, xattr`
  Plan predicted a similar list; actual adds platform-TLS glue (`schannel`, `security-framework*`, `foreign-types*`, `openssl-macros`, `openssl-probe`, `vcpkg`) and tar/xattr deps. Predicted `flate2`/`fastrand` did **not** appear — typst-kit doesn't pull them (tar/ureq handle their own compression). No unexpected dep added, no unrelated upgrade. Same graph the typst CLI ships (spec §4 accepted).

### Task 2 verification

- `cargo test`: **17 passed; 0 failed** (same as Task 1).
- `npm test`: **102 passed**.
- `git diff main --stat` confirmed scope discipline (see above).

## Manual smoke — NOT VERIFIED in this environment

Plan Task 2 Step 4 (network test, not in CI) could not run: headless environment, no display server, `npm run tauri dev` GUI not runnable.

| # | Checkpoint | Status |
|---|---|---|
| 1 | First-render download delay + fletcher diagram appears | **NOT VERIFIED** |
| 2 | Disk cache hit, no re-download on edit | **NOT VERIFIED** |
| 3 | Bad `@preview/no-such-package-xyz` → clean error banner, no crash | **NOT VERIFIED** (indirectly covered by `missing_package_is_clean_error`, which exercises the same `format_diag` path for the local-missing case) |
| 4 | `npm test` after manual smoke | **VERIFIED** — 102/102 pass |

## Deviations from the plan

1. **`SingleFileWorld::new(text: String)` wrapper deleted.** Plan included `fn new(text: String) -> Self { Self::with_packages(text, system_packages()) }`. After splitting the command to delegate to `compile_with_packages`, `new` had no caller — left out as dead code per ponytail (no scaffolding). `with_packages` keeps the `String` signature. Tests don't use `new`.
2. **Reviewer nit fold-in (Task 2):** plan text leaking into the doc comment block above `compile_typst` was deleted in commit `e1d8ec4`. One-line deletion in `typst_compile.rs`, bundled with the docs commit.
3. **Code-standardizer follow-up (post-Task-2, `dcede23`):** fixed the clippy `len_zero` lint in `compiles_trivial_doc` (only `len_zero` in the file; fix unambiguous; line pre-existed on `main`) and reflowed the long `system_packages()` `concat!` call to comply with `cargo fmt`. No `cargo fmt` sweep: pre-existing fmt drift in `main.rs`, `build.rs`, and 7 other sites of `typst_compile.rs` left untouched to preserve spec §6 scope.

## Standardization review

- **doc-standardizer: PASS.** One pre-existing quick-fix noted (duplicate `## [0.5.0]` heading in `CHANGELOG.md`, predates this branch) — left out of scope.
- **code-standardizer: FAIL with 4 quick-fixes.** Disposition:

| # | Finding | Disposition |
|---|---|---|
| QF-1 | clippy `len_zero` in `compiles_trivial_doc` | **Fixed** in `dcede23` |
| QF-2 | long `system_packages()` `concat!` call violates `cargo fmt` | **Fixed** (reflowed) in `dcede23` |
| QF-3 | missing project-wide formatter/lint config (`rustfmt.toml`, `[lints.clippy]`) | **Out of scope** — project-level policy; this branch should not establish it |
| QF-4 | pre-existing `items_after_test_module` layout (`utc_ymd`, `civil_from_unix_days` after `mod tests`) | **Out of scope** — pre-existing on `main`; not this branch's to fix |

## Documentation updates

| Catalog | Change | Commit |
|---|---|---|
| `CHANGELOG.md` | `[Unreleased]` → `### Added`: Typst package support bullet | `e1d8ec4` (executor; not duplicated here) |
| `README.md` | Typst preview limitations: packages now supported | `e1d8ec4` (executor; not duplicated here) |
| This report | **Created** | this close-out commit |

**AGENTS.md: no change needed.** `typst-kit` is a backend dependency cataloged in the declared dependency catalogs (`src-tauri/Cargo.toml` + lock, per AGENTS.md "Adding features"); the Components table's Backend row (`src-tauri/src/` — "File I/O, encoding, EOL, Typst, Tauri commands") already covers Typst compilation, and package wiring lives in the existing `src-tauri/src/typst_compile.rs`. No new command, capability, file association, npm dep, or dialog — nothing else to catalog.

**Version: no bump.** Per spec §9, release cutting is deliberate; `[Unreleased]` entry only. `feat` commits classify minor (0.6.0) whenever the user cuts the release.

## Verifier output (final state)

| Check | Command | Result |
|---|---|---|
| Backend build | `cargo build` (`src-tauri/`) | clean, no warnings |
| Backend tests | `cargo test` (`src-tauri/`) | **17/17 pass** (15 pre-existing + 2 new) |
| Frontend tests | `npm test` | **102/102 pass across 13 files** |
| Manual smoke (GUI) | `npm run tauri dev` + fletcher snippet | **NOT RUN** — headless environment |

## Choices registry

No `docs/artifacts/choices/` entry: repo AGENTS.md forbids extra siblings under `docs/artifacts/` (only `features/<feature>/` and `reviews/` are canonical). The rejected approaches are spec-level and live in spec §4:

- **Rejected:** hand-rolled downloader — same dep weight, ~150 lines re-implementing upstream typst-kit.
- **Rejected:** local-dirs-only resolution — fails the stated `@preview` ask.
- **Chosen:** `typst-kit` 0.15.1 (user-confirmed 2026-09-26).

Executor defaults: deviation 1 above (`new` wrapper dropped as dead code — ponytail, no scaffolding).

## Skills loaded

Executing-plans (orchestration), writing-plans (already authored), project-standardization (catalog discipline), code-standardization (post-plan audit), using-superpowers (process skill), verification-before-completion (gate before any success claim).

## `ponytail:` deferrals

1 new `ponytail:` comment introduced by this branch (per spec §3's planned deferral): `package_file` re-reads package files from disk every compile — fine at human typing rates; add an in-memory cache only if preview feels slow. (Pre-existing markers in `typst_compile.rs`, e.g. the `OnceLock` note, are untouched.) Run `/ponytail-debt` to harvest.

## Unverified items

- **Manual smoke (Plan Task 2 Step 4, GUI checkpoints 1–3):** see table above — not runnable headless. This is the residual risk before merge.
- **Project-wide formatter/lint config gap** (code-standardizer QF-3): recommendation only, unaddressed — belongs to a separate code-standardization pass.
- Duplicate `## [0.5.0]` heading in `CHANGELOG.md`: pre-existing on `main`, out of scope here; worth folding into the next docs pass.

## What the user must do before merge

1. Review the diff (`git diff main...feat/typst-packages`).
2. Run `npm run tauri dev`, open the fletcher snippet from Plan Task 2 Step 4 in the live editor, and confirm the four manual-smoke checkpoints: first-render download delay + diagram appears; disk cache (no re-download on edit); bad `@preview/no-such-package-xyz` → clean error banner, no crash; `npm test` still 102/102.

## Dispatch log

- **Task 1:** dispatched executor + reviewer — Task 1 PASS.
- **Task 2:** dispatched executor + reviewer — Task 2 PASS.
- **Structure review:** dispatched doc-standardizer (PASS) and code-standardizer (FAIL with findings) concurrently.
- **Quick-fix dispatch:** dispatched executor + reviewer for the two in-scope quick-fixes — PASS (`dcede23`).
- **Documenter:** this report.
