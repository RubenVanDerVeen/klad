# Rich Markdown Preview — Execution Report

- **Date:** 2026-09-18
- **Plan:** `docs/artifacts/features/rich-markdown-preview/2026-09-18-rich-markdown-preview-plan.md`
- **Spec:** `docs/artifacts/features/rich-markdown-preview/2026-09-18-rich-markdown-preview-design.md`
- **Status:** **PASS** — ready for human smoke-test + merge
- **Branch:** `feat/rich-markdown-preview` (base `59eb008`, the v0.4.0 report commit on `main`)

## 1. Summary

The plan gave Klad's Markdown preview the hermes-console flavor: KaTeX math
(`$...$` inline with pandoc-style guards, `$$...$$` block), Mermaid diagrams
(` ```mermaid ` fences), interactive function plots ( ```plot fences,
function-plot), two-column layouts ( ```columns fences split on `||`),
image percent sizing (`{N%}` suffix), and — a pre-existing gap — relative
image resolution against the open file via the Tauri asset protocol. The
architecture held: marked extensions emit plain host divs (`data-src`
pattern), DOMPurify stays the last string-level step, and heavy renders
(mermaid, function-plot) mount on live DOM afterwards via lazy imports.

Seven commits on `feat/rich-markdown-preview`: six implementation/docs
commits (Tasks 1–6) plus one spec/plan docs commit. Total diff vs base:
**19 files changed, +2996 / −90** (the bulk is `package-lock.json` and two
new modules).

Verification (all re-run at report time): `npm test` **12 files / 81 tests
passed, 0 failed** (26 new tests vs the v0.4.0 baseline of 55); `npm run
build` green (12.98 s, chunk-size warnings only — mermaid 597 kB and katex
261 kB land as separate lazy chunks, confirming the dynamic-import design);
`cd src-tauri && cargo test` **15 passed / 0 failed**.

## 2. Per-task summary

### Task 1 — KaTeX math (`$...$` inline, `$$...$$` block)

- **Commit:** `9572767` `feat(preview): render inline and block math with KaTeX`
- **Files:** `package.json`, `package-lock.json` (+katex ^0.18.7,
  +marked-katex-extension ^5.1.13), `src/render.ts` (+61), `src/main.ts`
  (+1, katex CSS import), `src/__tests__/render.test.ts` (+20).
- **Tests:** +4 (`renders inline math`, `renders block math`, `keeps pure
  currency amounts literal`, `renders math glued to prose`); full suite green.
- **Reviewer verdict:** PASS.
- **Deviations:** no `@types/katex` (katex 0.18.7 ships its own types — the
  plan made this conditional); marked-katex-extension ^5 peer-accepts marked
  15, so the plan's fallback branch was never needed; one-line type cast in
  the inline-rule filter (see Deviations table).

### Task 2 — Host extensions: mermaid, plot, columns, image `{N%}`

- **Commit:** `ad3522d` `feat(preview): emit mermaid, plot, columns hosts and sized images`
- **Files:** `src/render.ts` (+95), `src/__tests__/render.test.ts` (+47).
- **Tests:** +8 (mermaid host with visible source, plot host with escaped
  JSON, columns split on `||`, three columns from two separators,
  separator-less fence as one column, percent width applied, out-of-range
  scale kept literal, scripts still stripped with extensions active); full
  suite green.
- **Reviewer verdict:** PASS.
- **Deviations:** none.

### Task 3 — Rich-block mounting (`src/rich-blocks.ts`) + preview CSS

- **Commit:** `8408e23` `feat(preview): mount mermaid diagrams and function plots after sanitize`
- **Files:** `package.json`, `package-lock.json` (+mermaid ^11.17.2,
  +function-plot ^1.25.4), `src/rich-blocks.ts` (new, 186 lines),
  `src/styles.css` (+45), `src/__tests__/rich-blocks.test.ts` (new).
- **Tests:** +6 in the new file (`parsePlotSrc` accepts valid JSON / rejects
  trailing commas / rejects comments and single quotes / rejects non-object
  JSON; `mermaidThemeFor` dark→dark mapping; `mountRichBlocks` marks invalid
  plot JSON as `plot-error` without loading function-plot); full suite green.
- **Reviewer verdict:** PASS.
- **Deviations:** none.

### Task 4 — Image resolution (`src/images.ts` + asset protocol)

- **Commit:** `c355bab` `feat(preview): resolve relative images via the asset protocol`
- **Files:** `src/images.ts` (new, 30 lines), `src/__tests__/images.test.ts`
  (new, 6 tests), `src-tauri/tauri.conf.json` (assetProtocol enable +
  image-only scope), `src-tauri/Cargo.toml` (+`protocol-asset` feature on the
  existing `tauri` dep), `src-tauri/Cargo.lock`.
- **Tests:** +6 (dirName splits windows/posix paths; rewrites relative paths
  against baseDir; passes absolute urls/schemes through untouched; no-op
  without base dir ×2 — src and DOM-container levels); full suite green;
  `cargo test` still 15/15 (catches tauri.conf schema typos early).
- **Reviewer verdict:** PASS.
- **Deviations:** three, all recorded in the commit body — see the table
  below. The notable one: `src-tauri/capabilities/default.json` is unchanged
  because Tauri 2.11.5 has no `asset:*` capability permission at all; the
  asset protocol is gated purely by `app.security.assetProtocol` plus the
  Cargo feature.

### Task 5 — Preview wiring (base dir + mount calls)

- **Commit:** `d3c79a0` `feat(preview): wire rich blocks and image resolution into live render`
- **Files:** `src/preview.ts` (+13: `setPreviewBaseDir` state + md-render
  tail `innerHTML → resolveImages → mountRichBlocks`), `src/main.ts` (+3:
  `setPreviewBaseDir(meta.path ? dirName(meta.path) : null)` in
  `applyPreviewMode`), `src/__tests__/preview-images.test.ts` (new).
- **Tests:** +2 (rewrites relative image src against the active base dir;
  leaves images alone without a base dir); full suite green.
- **Reviewer verdict:** PASS.
- **Deviations:** none.

### Task 6 — Docs, catalogs, full verification

- **Commit:** `62cf4bd` `docs: describe rich markdown preview additions`
- **Files:** `README.md` (preview bullet extended with the six additions),
  `CHANGELOG.md` (`[Unreleased] → Added` entry).
- **Tests:** none (docs only); full verification matrix green (Section 4).
- **Reviewer verdict:** PASS.
- **Deviations:** none. Manual smoke (Step 4) deferred to the human — see
  Section 6.

### Spec/plan docs commit

- **Commit:** `a165e4c` `docs(preview): add rich markdown preview spec and plan`
- **Files:** the design (+100) and plan (+957) documents in
  `docs/artifacts/features/rich-markdown-preview/`.

## 3. Deviations summary (consolidated)

| Task | Deviation | Why | Risk |
|---|---|---|---|
| 1 | `@types/katex` not added | katex 0.18.7 ships its own types (`types/katex.d.ts`); the plan's step was conditional on types being absent | None |
| 1 | One-line cast `(e as { level?: string }).level` when filtering marked-katex's inline rule | Plan's verbatim `e.level !== "inline"` fails typecheck: the `TokenizerAndRendererExtension` union includes `RendererExtension`, which has no `level` field | None (type-level only, behavior unchanged) |
| 4 | `capabilities/default.json` left unchanged (plan said add `"asset:default"`) | Tauri 2.11.5 has no `asset:*` capability permission — the build script rejects the identifier; the protocol is gated by `security.assetProtocol` config alone | Low — see Risks; runtime confirmation pending in human smoke |
| 4 | `Cargo.toml` gained `protocol-asset` feature on the existing `tauri` dep (file not in the plan's Task 4 list) | tauri's build script enforces the feature when `assetProtocol` is enabled | None — catalog updated in the same change |
| 4 | `resolveImageSrc` normalizes internal backslashes to `/` | The plan's verbatim code left them, but the plan's own test expects `asset:.../sub/pic.png` from `sub\pic.png`; one-line fix, marked `ponytail:` | None — ceiling noted in the comment (switch to `URL` if percent-encoding or UNC paths matter) |

Non-deviation worth noting: marked-katex-extension resolved to `^5.1.13`
(plan pinned `^5.1.12`) — within the caret range, and its peer range accepts
marked 15, so the plan's fallback ("newest major that accepts marked 15")
was never exercised.

## 4. Verification matrix

| Check | Result | Detail |
|---|---|---|
| `npm test` | **81 passed / 0 failed** (12 files) | 26 new tests: render.test.ts 6→18, rich-blocks.test.ts +6, images.test.ts +6, preview-images.test.ts +2. Baseline at `59eb008` was 55 tests / 9 files |
| `npm run build` | **Green** | `✓ built in 12.98s`; tsc clean. Chunk-size warnings only; mermaid (597 kB) and katex (261 kB) ship as separate lazy chunks, confirming the dynamic-import design |
| `cd src-tauri && cargo test` | **15 passed / 0 failed** | `test result: ok. 15 passed; 0 failed; 0 ignored` — unchanged count (backend config-only change) |

All three re-run at report time on the branch head.

## 5. Catalog compliance (AGENTS.md "Adding features" checklist)

| Catalog | Status | Detail |
|---|---|---|
| `package.json` | ✓ | `katex ^0.18.7`, `marked-katex-extension ^5.1.13`, `mermaid ^11.17.2`, `function-plot ^1.25.4` |
| `src-tauri/Cargo.toml` | ✓ | `tauri` dep gained `protocol-asset` feature — deviation from the plan's listed files but required by the build script when assetProtocol is enabled |
| `src-tauri/tauri.conf.json` | ✓ | `security.assetProtocol`: enabled, image-extension-only scope |
| `src-tauri/capabilities/default.json` | ⚠ unchanged (intentional) | Tauri 2.11.5 has no `asset:*` permission; build-script acceptance verified the config is sufficient |
| `src-tauri/src/main.rs` | ✓ unchanged | No new Tauri commands |
| `src/fileio.ts` | ✓ unchanged | No new IPC wrappers |
| `index.html` | ✓ unchanged | No new dialogs |
| `README.md` | ✓ | Preview bullet extended (Task 6) |
| `CHANGELOG.md` | ✓ | `[Unreleased] → Added` entry (Task 6) |

No catalog drift: every new item landed in every applicable catalog within
its task's commit.

## 6. Manual smoke (requires human confirmation)

Plan Task 6 Step 4 checklist, with current verification status:

| Item | Status |
|---|---|
| Inline math | Verified by unit test (`renderMarkdown > renders inline math`) |
| Block math | Verified by unit test (`renders block math`) |
| Mermaid ` ```mermaid ` host emits | Verified by unit test (`emits a mermaid host with visible source`) |
| Mermaid SVG output | **Requires human confirmation** (dagre layout, label legibility) |
| Plot interactive pan/zoom | **Requires human confirmation** (function-plot lib behavior; jsdom has no DOM geometry) |
| Plot trailing-comma → raw text + red error | Verified by unit tests (`parsePlotSrc` + `mountRichBlocks` error path) |
| Columns ` ```columns ` | Verified by unit tests (3 sub-tests: split, three columns, separator-less) |
| Image `{N%}` sizing | Verified by unit tests (2 tests: applied + out-of-range literal) |
| Image visual proportion | **Requires human confirmation** |
| Relative image resolution | Wiring verified by unit test; **requires human confirmation** for the Tauri asset protocol actually serving bytes in the real WebView |
| Theme flip re-themes mermaid + plot axes | Mapping verified by unit test (`mermaidThemeFor`); **requires human confirmation** for axis re-color in the running app |

## 7. Deferred items

The code-standardization audit flagged 3 quick-fix findings, all **deferred**:

1. **Formatter/linter config missing** (no ESLint/Prettier for the TS side).
2. **`cargo fmt` drift** in existing backend files.
3. **`renderMarkdown` doc comment** (missing/undersized JSDoc on the changed
   export).

These are repo-wide concerns, not features of this branch: a lint toolchain
and format pass touch every file and belong in a dedicated
repo-standardization plan with its own spec/plan/report cycle, not bolted
onto a feature branch under review. Items 1 and 2 also overlap follow-ups
already tracked in `.agents/todolist.md` since v0.4.0 ("TypeScript
lint/format toolchain missing", "Rust lints not wired", "No pre-commit lint
hook"). None of them block merge.

## Skills loaded

- `subagent-driven-development` — mandated by the plan header; drove the
  task-by-task executor/reviewer dispatch.
- `ponytail` — active throughout (session mode); visible in the
  smallest-diff decisions (single-line fixes, `ponytail:` markers with
  ceilings named).
- `code-standardization` — loaded by the code-standardizer for the post-plan
  diff audit (findings in Section 7).
- `verification-before-completion` — enforced by reviewers during execution
  and by the documenter: the full verification matrix (Section 4) was re-run
  on the branch head before this report was written.

## `ponytail:` deferrals

Exactly one new marker, both deliberate and ceiling-named:

- `src/images.ts:17` — internal-backslash normalization for Windows-relative
  image refs; upgrade path: switch to `URL` if percent-encoding or UNC paths
  matter.

(The other five `ponytail:` markers in `src/` predate this branch.)

## 8. Risks

1. **Tauri asset protocol permission identifier not exercised at runtime.**
   The config path (no `asset:*` capability, `security.assetProtocol` +
   `protocol-asset` Cargo feature) is verified only via build-script
   acceptance — no dev session has rendered a real image through it yet.
   *Mitigation:* the human smoke test must confirm an image next to an
   opened `.md` file actually displays.
2. **Mermaid `-->` source mXSS guard fallback.** DOMPurify strips
   `data-src` when the diagram source contains `-->`; the mount code then
   falls back to `textContent`. Implemented in Task 3 (`rich-blocks.ts`) but
   not exercised by a unit test. *Mitigation:* the human smoke test should
   render ` ```mermaid\nA --> B\n``` ` and confirm the diagram (not raw
   text) appears.

## Unverified items

Everything still needing the human smoke run (Section 6): mermaid SVG
output, plot pan/zoom and visual proportion, image visual proportion,
relative image byte-serving in the real WebView, and theme-flip axis
re-color — plus risk 2's `-->` diagram. No automated check remains red.

## 9. Verdict

**PASS.** 6 task commits + 1 spec/plan docs commit on
`feat/rich-markdown-preview` (7 total before this report), all deviations
recorded in commit bodies and consolidated above, full verification matrix
green, no catalog drift. The branch is ready for human smoke-test + merge.

## Dispatch Log

| Dispatch | Agent | Outcome |
|---|---|---|
| Task 1 | executor + reviewer | PASS (3 recorded deviations, all type/version-level) |
| Task 2 | executor + reviewer | PASS, no deviations |
| Task 3 | executor + reviewer | PASS, no deviations |
| Task 4 | executor + reviewer | PASS (3 recorded deviations, all Tauri-2.11.5 reality) |
| Task 5 | executor + reviewer | PASS, no deviations |
| Task 6 | executor + reviewer | PASS (manual smoke deferred to human) |
| Spec/plan | executor | `a165e4c` landed |
| Code audit | code-standardizer | 3 repo-wide quick-fixes deferred (Section 7) |
| Report | documenter (this report) | — |
