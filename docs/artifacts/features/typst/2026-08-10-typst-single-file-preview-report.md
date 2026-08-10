# Typst Single-File Live Preview — Execution Report

- **Date:** 2026-08-10
- **Branch:** `feat/typst-preview` (cut from `main`, 7 commits)
- **Status:** **DONE — code + unit + integration green; SMOKE UNTESTED in the orchestrator's headless environment**
- **Spec:** [`docs/artifacts/specs/typst/2026-08-10-typst-single-file-preview-design.md`](../../specs/typst/2026-08-10-typst-single-file-preview-design.md)
- **Plan:** [`docs/artifacts/plans/typst/2026-08-10-typst-single-file-preview-plan.md`](../../plans/typst/2026-08-10-typst-single-file-preview-plan.md)

## Goal

Open a `.typ`/`.typst` file in klad and see live typst-rendered pages in the preview pane, debounced on keystroke, alongside the existing Markdown preview. v1 is deliberately single-file: no folder/project model, no `#include`/`#import` resolution, no `@preview` packages, no system fonts, no PDF export — those are a separate folder-mode slice (spec §9).

## Architecture summary

One new Tauri command `compile_typst(text) -> { pages: Vec<String-svg>, errors }` backed by a `SingleFileWorld` impl of typst's `World` trait (source from the LF-normalized editor buffer, fonts embedded via `typst-assets`, all file/package lookups return errors → `#include`/`#import`/`@preview` all surface as clean compile errors, pinning v1 to single-file). The existing `src/preview.ts` module learns a `previewKind: 'md' | 'typ'` state set by `applyPreviewMode()` in `main.ts`; on `'typ'` it fires a race-guarded async compile (monotonic `renderToken`) and stacks per-page SVGs, keeping last-good + showing an error banner on failure. Two debounce instances preserve Markdown's 150ms while typst uses 400ms. No `index.html` change (banner built from TS), no new `capabilities/default.json` permission (`compile_typst` is compute-only), no new frontend dep. Full design rationale, the typst-vs-markdown delta table, the behavior matrix, and the resolved brainstorm forks live in spec §1–§5, §8.

## Branch and commits

| SHA | Type | Scope | Subject |
|---|---|---|---|
| `2dc0f70` | feat | typst | add `compile_typst` Tauri command + `SingleFileWorld` |
| `0db9c9e` | feat | preview | add typst kind dispatch with race-guarded async render |
| `094c0c3` | feat | typst | wire `applyPreviewMode` + `.typ`/`.typst` file association |
| `c152192` | fix | preview | hide typ banner when switching to a markdown tab |
| `6d44833` | docs | release | note typst live preview under `[Unreleased]` |
| `783bee6` | docs | agents | reflect `md\|typ` in preview auto-toggle regex |
| `c6fe3f8` | docs | typst | add single-file preview spec + plan |

Branch base: `main`. Linear history (no merge commits). Commits are listed oldest-first above; the orchestrator brief listed them newest-first.

## Files changed (diff stats)

```
 AGENTS.md                                          |    2 +-
 CHANGELOG.md                                       |    4 +-
 docs/.../2026-08-10-typst-single-file-preview-plan.md      |  871 +++++++++
 docs/.../2026-08-10-typst-single-file-preview-design.md    |  241 +++
 src-tauri/Cargo.lock                               | 1862 +++++++++++++++++++
 src-tauri/Cargo.toml                               |    4 +
 src-tauri/src/main.rs                              |    4 +-
 src-tauri/src/typst_compile.rs                     |  253 +++
 src-tauri/tauri.conf.json                          |    3 +-
 src/__tests__/typst-preview.test.ts                |   53 +
 src/fileio.ts                                      |   14 +
 src/main.ts                                        |   18 +-
 src/preview.ts                                     |   90 +-
 13 files changed, 3368 insertions(+), 51 deletions(-)
```

Catalog-rule cross-check (AGENTS.md "Adding features…"): `compile_typst` is registered in **both** `main.rs invoke_handler![]` and `src/fileio.ts` (`compileTypst` wrapper); the `.typ`/`.typst` association lands in **both** `tauri.conf.json bundle.fileAssociations` and the Open-dialog `FILTERS` in `main.ts`. No two catalogs disagree. No new capability was added (correctly — `compile_typst` is compute-only).

## Per-task status

### Task 1 — Backend `compile_typst` + `SingleFileWorld` — PASS

- **Versions resolved and pinned** (spec §10 verify-before-implement gate): `typst = "0.15.1"`, `typst-assets = "0.15.1"` (fonts feature), `typst-svg = "0.15.1"`, `typst-layout = "0.15.1"`. World-trait surface verified against the pinned source (0.15.1 has no `package`/`resolve` methods on `World` — confirmed). SVG emission is via the separate `typst-svg` crate (the plan flagged this conditional under Task 1 Step 1).
- **Three inline tests pass:** trivial-doc happy path, malformed-doc error path, v1 boundary (`#include "other.typ"` → clean error mentioning the file, not a panic).
- `cargo test`: 15/15. `cargo build`: clean. `cargo clippy -D warnings`: clean.

### Task 2 — Frontend `compileTypst` wrapper + preview.ts dispatch + race guard — PASS

- `compileTypst(text)` wrapper in `src/fileio.ts` mirrors the Rust `TypstResult`/`TypstError` shape.
- `preview.ts` gains `previewKind` state + `setPreviewKind` setter; the `'typ'` branch is async and race-guarded.
- **Race guard** (`pickRender` + `++renderToken`) is the only correctness-critical new logic, pinned by 3 unit tests (applies when token is latest; drops when newer started; drops on slow-then-fast interleaving).
- Two debounce instances (md=150ms, typ=400ms). Error banner built from TS, lazily attached to the pane's parent.
- `npm test`: 55/55 (existing 48 + 7 new). `npx tsc --noEmit`: exit 0.

### Task 3 — Wire `applyPreviewMode` + filters + file association + smoke — PASS (code + tests); SMOKE UNTESTED

- `isMarkdown`/`isTypst` predicates added; `applyPreviewMode` rewritten per spec §4.3; `FILTERS` gains `typ`/`typst`; `tauri.conf.json bundle.fileAssociations` gains the `.typ`/`.typst` association (compute-only → no new capability).
- All automated checks green (`npm test` 55/55, `npx tsc --noEmit` exit 0, `cargo test` 15/15).
- **Manual smoke scenarios 1–7 NOT exercised** in the orchestrator's environment (headless, no display, no UI automation). Evidence the app launches: `npm run tauri dev` succeeded (Vite on `:1420`, Rust binary built and launched), but no window could be visually inspected. Smoke fixture prepared at `C:\Users\ruben\AppData\Local\Temp\opencode\typst-smoke.typ`. Linux scenario 9 not attempted (Windows-only environment).
- **Follow-up fix applied during Task 3 review** (commit `c152192`): the sync md branch of `renderPreviewNow` was missing a `hideErrorBanner()` call, so a typst error banner persisted across a tab switch to a `.md` file (the banner is a sibling of `#preview`, not inside it — so replacing `pane().innerHTML` didn't clear it). Plan scenario 6 explicitly forbids that persistence. One-line fix; no test added because pinning it cleanly would require DOM mocking (forbidden by project test convention) — the banner-persist case is covered by the manual smoke instead.

## Standardization review

The standardizer returned **3 quick-fixes** (dispatched, executed, reviewed, landed) and **3 recommendations** (deferred per the orchestrator's process rule — recommendations are not auto-fixed).

**Quick-fixes applied:**

| # | Finding | Disposition | Commit |
|---|---|---|---|
| QF-1 | `CHANGELOG.md` `[Unreleased] > Added` had a placeholder bullet | Replaced with a real bullet describing the typst preview feature | `6d44833` |
| QF-2 | `AGENTS.md` "Preview auto-toggle" regex documented only `md\|markdown` after the branch landed typst | Regex → `md\|markdown\|typ\|typst`; added `isTypst`/`setPreviewKind` kind-dispatch note | `783bee6` |
| QF-3 | Spec + plan files were not yet committed (the branch's code commits ran under the carve-out but the authorizing artifacts were missing) | Committed both under the canonical `docs/artifacts/…` paths | `c6fe3f8` |

**Recommendations deferred (carried to the user):**

| # | Finding | Why deferred |
|---|---|---|
| REC-1 | `AGENTS.md` "Stack" section has minor descriptive drift | Cosmetic; not introduced by this branch |
| REC-2 | Repo-wide lint/format config (e.g. a formatter/hooks setup) | Out of scope for this feature branch; belongs to a code-standardization pass of its own |
| REC-3 | `.superpowers/` should be added to `.gitignore` | Cleanliness only; the directory is currently untracked and not committed |

## Documentation updates (this report + catalog pass)

Catalogs touched by this report commit:

| Catalog | Change | Why |
|---|---|---|
| `docs/artifacts/features/typst/2026-08-10-typst-single-file-preview-report.md` | **Created** | This execution report (new artifact home; first entry under `docs/artifacts/features/`) |
| `README.md` | "Features" list + "Opens anything Notepad opens" line + Windows default-editor list | **Catalog miss from the run.** `tauri.conf.json bundle.fileAssociations` now associates `.typ`/`.typst` but README still listed only `.txt .md .log .ini .cfg`. Two-catalogs-disagree red flag; fixed here so the user-facing feature list reflects what shipped |
| `AGENTS.md` "Artifacts" section | Added `features/` to the enumerated artifact homes | New artifact type introduced by this report; the catalog of artifact homes must list it |
| `STANDARDS.md` "Specs, plans, reviews" section | Added `features/` row | Same — the human-contract catalog of `docs/artifacts/` homes must list the new home |

Catalogs already correct (no change in this commit):
- `CHANGELOG.md` `[Unreleased] > Added` — fixed by QF-1 (commit `6d44833`); confirmed reads correctly.
- `AGENTS.md` "Preview auto-toggle" — fixed by QF-2 (commit `783bee6`); confirmed regex + kind-dispatch note present.

## Verifier output (final state)

| Check | Command | Result |
|---|---|---|
| Backend tests | `cargo test --manifest-path src-tauri/Cargo.toml` | **15 passed, 0 failed** (12 `fs_cmds` + 3 `typst_compile`) |
| Frontend tests | `npm test` | **55 passed, 0 failed** across 9 files (existing 48 + 7 new `typst-preview`) |
| Typecheck | `npx tsc --noEmit` | **exit 0**, no output |
| Backend lint | `cargo clippy -D warnings` | clean (reported during Task 1) |
| Backend build | `cargo build` | clean |
| Dev-app launch | `npm run tauri dev` | succeeded (Vite `:1420`, Rust binary launched) |

## Smoke status — UNTESTED in orchestrator environment

**The seven visual acceptance scenarios (plan Task 3 Step 6; spec §7.3) were NOT exercised.** The orchestrator's environment is headless: no display, no UI automation. `npm run tauri dev` proved the app builds and launches, but no window was inspected. Code + unit + integration-test evidence is strong (race guard unit-tested, v1 boundary unit-tested, all type/compile/lint checks green), but the visual acceptance gate — open `.typ` → renders, live keystroke, last-good-on-error, `#include` clean error, fast-typing race, tab-switch md↔typ, tab-switch typ→txt, open-dialog filter — was not run.

**Prepared fixture:** `C:\Users\ruben\AppData\Local\Temp\opencode\typst-smoke.typ`

**Recommended user action on pull:**
```sh
git checkout feat/typst-preview
npm install
npm run tauri dev
# open the fixture above, walk plan Task 3 Step 6 scenarios 1–7
```

Linux scenario 9 (deb/appimage) also not attempted — Windows-only environment.

## Deferred / follow-ups

| Item | Status | Note |
|---|---|---|
| **typst 0.15.1 vs spec target** | Watch | Spec §10 said "resolve the latest stable"; 0.15.1 is current at run time. A 0.16.x in coming months will shift the `World` trait again — re-run the verify-before-implement gate (plan Task 1 Step 2) when bumping. |
| **Release binary size** | Unmeasured | `cargo test` checks only the debug build. Spec §9 estimated +5–15 MB (typst + typst-assets + transitives: icu, comemo, hayagrifa). Next release run will quantify. |
| **UTC date in `today()`** | Accepted | Ponytail choice: stdlib only, no `chrono`/`time` dep, no Win32 FFI for local-zone. Documented inline with the upgrade path. CET users see UTC dates in `#datetime`. |
| **Banner-persistence on md-switch** | Fixed inline (commit `c152192`) | Discovered in Task 3 review; one-line `hideErrorBanner()` added to the sync md branch. |
| **Standardizer REC-1** (AGENTS.md "Stack" drift) | Deferred | Cosmetic; not from this branch. |
| **Standardizer REC-2** (repo-wide lint/format config) | Deferred | Belongs to a separate code-standardization pass. |
| **Standardizer REC-3** (`.superpowers/` → `.gitignore`) | Deferred | Cleanliness only; the dir is untracked and not committed. |
| **Folder/project mode** (file tree, `#include`/`#import`, `@preview`, system fonts, PDF export) | Deferred to separate spec | Spec §9 lists the full deferred set. |

## Anything surprising

1. **SVG emission lives in a separate `typst-svg` crate** at 0.15.1 — the plan flagged this as a conditional in Task 1 Step 1 ("if the pinned version splits it into `typst-svg`, add that"). It does. Also pulled in `typst-layout = "0.15.1"` transitively required by the compile path.
2. **0.15.1 `World` has no `package`/`resolve` methods** — confirmed against source before implementing. The trait surface is narrower than the plan's skeleton comment listed, which simplified `SingleFileWorld`.
3. **Banner persistence bug surfaced only at Task 3 review**, not in earlier code review — because the banner is a sibling of `#preview` (attached to `pane().parentElement`), the md branch's `pane().innerHTML = …` doesn't clear it. Plan scenario 6's wording caught it where spec §5's behavior matrix was looser. Worth a note for the folder-mode spec: error-banner lifecycle is tied to kind-switches, not just render results.
4. **Smoke gap is the real residual risk.** Every automated gate is green, but the feature is "open file → see rendered pages" — a fundamentally visual acceptance. The user should run the smoke before tagging a release that includes this.

## Dispatch log

- **Task 1:** dispatched executor + reviewer. Both passed.
- **Task 2:** dispatched executor + reviewer. Both passed.
- **Task 3 (code):** dispatched executor + reviewer. Both passed; reviewer flagged banner-persistence bug.
- **Task 3 (banner-fix):** dispatched executor + reviewer. Both passed (one-liner; executor report self-contained).
- **Standardizer:** dispatched standardizer. Returned 3 quick-fix + 3 recommendation findings.
- **Standardizer quick-fixes:** dispatched executor + reviewer for each. Both passed.
- **Documenter:** dispatched documenter (this report).
