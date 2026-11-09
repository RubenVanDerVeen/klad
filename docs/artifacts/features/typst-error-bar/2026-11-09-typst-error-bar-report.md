# Report: Typst error bar

Spec: `2026-11-09-typst-error-bar-design.md`
Plan: `2026-11-09-typst-error-bar-plan.md`
Branch: `feat/typst-error-bar`, cut from `main`. Date: 2026-11-09.

## Summary

Typst compile errors used to render as a full-height pink column left of the file tree. Root cause: `errorBannerEl()` prepended the banner to `pane().parentElement`, which is `#content`, a `display: flex` row, so the banner became the row's first flex child and stretched to full height. The banner is now the first child **inside `#preview`** (the scroll container): a slim, single-line bar pinned with `position: sticky; top: 0`, full-bleed across the pane, showing the first error with ellipsis truncation, the full text on hover (`title`), a `+N` count badge when more errors exist, and a dismiss button. Styling moved from inline styles to a theme-aware `#preview-error` block in `src/styles.css` (light + dark). Frontend-only change: no Rust, no `index.html`, no dependencies, no splitter or `uilayout.ts` changes. Version bumped 0.8.0 -> 0.9.0 (minor).

## Branch and commits

| Hash | Subject |
|------|---------|
| `86f27d3` | docs: spec and plan for typst error bar |
| `94b37b3` | feat(preview): show typst errors on slim bar atop preview pane |
| (this commit) | docs: execution report for typst error bar |
| (next commit) | docs: changelog and version bump for typst error bar |

## Files changed

Feature commit `94b37b3` (3 files, +203/-19); whole branch vs `main` before close-out: 5 files, +562/-19.

- `86f27d3`: `docs/artifacts/features/typst-error-bar/2026-11-09-typst-error-bar-design.md`, `...-plan.md` (new)
- `94b37b3`: `src/preview.ts` (+37/-19), `src/styles.css` (+49), `src/__tests__/typst-error-bar.test.ts` (+117, new)
- close-out: this report, `docs/artifacts/choices/2026-11-09-typst-error-bar-decision.md`, `docs/artifacts/choices/index.md`, `README.md`, `AGENTS.md` (commit 1); `CHANGELOG.md`, `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (own-package version entry, commit 2)

### What changed per file

- `src/preview.ts`: `errorBannerEl()` now builds the bar in TypeScript and prepends it to `pane()` itself (`#preview`), not `pane().parentElement`. The element is cached in a module-level `errorBanner` variable and validated with an `isConnected` check, because `pane().innerHTML` on a successful render orphans the cached node; the bar is lazily rebuilt on the next error. `showErrorBanner(errors: TypstError[])` (was a single error) renders the first error's text, sets `title` to text + ` (+N more)`, fills the `.preview-error-count` badge, and unhides the bar. The `.preview-error-close` button (`type="button"`, `aria-label="Dismiss error"`, glyph via textContent) hides it. `applyTypstResult` passes the whole error array; hide triggers unchanged (successful typst compile, markdown/CSV branches, `setPreviewVisible(false)`).
- `src/styles.css`: new `#preview-error` block at line 215 (directly after the `.mermaid-error` dark override, before the Tab bar section): `position: sticky; top: 0; z-index: 5`, flex baseline row, `margin: 0 -16px` canceling `#preview`'s `0 16px` padding (full-bleed), `white-space: nowrap` with ellipsis on `.preview-error-msg`, `.preview-error-close` styled after `.tab-close`, and a `[data-theme="dark"]` override using the `.plot-error` red pair (`#2e1a1a` / `#f87171`).
- `src/__tests__/typst-error-bar.test.ts`: 5 tests. (1) bar renders as a direct child of `#preview` with first-error text, `+1` badge, full-text `title`, and close button; (2) single error omits the count badge (span stays in the DOM, empty); (3) dismiss button hides the bar; (4) a later successful compile removes the bar from the DOM entirely (innerHTML wipe) and shows the page; (5) the bar is recreated with correct text after its element was orphaned by a successful render (cache-invalidation regression).

### Behavior spec as implemented

- Bar is the first child of `#preview`, full-bleed across the pane, pinned via `position: sticky; top: 0` (`#preview` is the scroll container, so the bar stays pinned while pages scroll and occupies its own flow space, no overlap).
- Single line with ellipsis; full multi-error text on the `title` attribute.
- Message text format unchanged: `${filePart}${linePart}${message}`, with the `file:` prefix still gated on `lastCompileRoot`.
- `+N` badge only when `errors.length > 1`; the badge span is always present and emptied otherwise.
- Dismiss hides the bar; the next compile result re-evaluates it, so a persistent error re-appears (intended).
- Auto-hide on successful typst compile, markdown/CSV render, and preview hide, as before.

## Verification

Independently re-run by the orchestrator on the final tree:

- `npx vitest run src/__tests__/typst-error-bar.test.ts`: PASS, 5/5 tests.
- `npm test`: PASS, 17 test files, 138/138 tests.
- `npm run build`: PASS, `tsc` clean, vite build succeeded (only the pre-existing >500 kB chunk-size warning).
- `cd src-tauri && cargo test`: not re-run, the branch touches no Rust code.

## Plan deviations

1. Version numbers: the plan says "0.7.2 -> 0.8.0 expected", but that line was written before v0.8.0 shipped (v0.8.0 tagged and released 2026-10-06; all three version files read 0.8.0 at branch time). Correct minor bump from the actual current version: **0.8.0 -> 0.9.0**. Used 0.9.0.
2. Release handling: the version files are bumped to 0.9.0 and the CHANGELOG gains an `[Unreleased]` entry, but `[Unreleased]` is not renamed to a version heading, no link ref is added, and no `chore(release): v0.9.0` commit or tag is made. Release cutting stays user-invoked in this run (see Unverified items).

No code deviations: Task 1 was implemented as written in the plan; all seven steps and the verification checklist map one-to-one to the shipped diff.

## Standardization review

- Reviewer verdict on `94b37b3`: PASS, no findings.
- Code-standardizer and doc-standardizer: scheduled to run after this close-out dispatch; no findings available at authoring time. If they surface follow-ups, those land as small fixes on this branch and this section can be amended then.

## Documentation updates

- `CHANGELOG.md`: new `## [Unreleased]` section (above `## [0.8.0]`) with `### Changed`: "Typst compile errors now shown on a slim bar atop the preview pane." No release rename or link ref (user-invoked release step).
- `README.md`: Typst preview section now says compile errors appear on a slim bar atop the preview pane (was: "in a banner") while the last good preview stays visible; the Packages paragraph's stale "preview banner" wording updated to the error bar. Everything else verified current: install/dev commands, paths, and feature bullets are untouched by this change.
- `AGENTS.md`: Versioning "Last release" line fixed from `v0.7.2 - 2026-10-02` to `v0.8.0 - 2026-10-06`. No other change: no new module, command, dependency, or permission; component table rows still accurate.
- Choices registry: `docs/artifacts/choices/2026-11-09-typst-error-bar-decision.md` plus one row in `docs/artifacts/choices/index.md`, status `active`. No prior entry superseded.

## Skills loaded

- Feature review: reviewer pair on `94b37b3` (PASS).
- Close-out: documenter (this report, decision record, catalogs, ship bump).

## ponytail: deferrals

None new. The carried `ponytail:` note in `showErrorBanner` (gate the `file:` prefix on `lastCompileRoot`, because `Source::detached` still interns a FileId without a workspace) documents preserved behavior, not new debt. Full error-list panel and click-to-jump-to-line remain unbuilt by design (spec: out of scope); the `+N` badge plus `title` is the lazy surface.

## Unverified items / left for the user

CSS-only behavior, not verifiable in jsdom (needs a display):

1. Sticky pinning: the bar stays at the top of `#preview` while pages scroll under it.
2. Full-bleed: `margin: 0 -16px` visually cancels the pane padding edge to edge.
3. Ellipsis truncation of long messages at narrow pane widths.
4. Light and `[data-theme="dark"]` colors.

Manual smoke test: `npm run tauri dev`, open a `.typ` file, introduce an error (bar appears, last good preview stays), add a second error (`+1` badge and title), scroll (bar stays pinned), hover (full text), click the dismiss button (bar hides, reappears on next keystroke while the error persists), switch theme.

The `file:` prefix path is exercised only through the `lastCompileRoot` gate: the tests pin its absence in a fixture without a project provider; the positive path (prefix shown with an opened folder) relies on the unchanged pre-existing gate.

User-invoked (deliberately not done here): the release cut, namely rename `[Unreleased]` to `## [0.9.0] - <date>` + link ref in a `chore(release): v0.9.0` commit, then `git tag -a v0.9.0` and push. No PR per instruction.

## Dispatch Log

| Task | Dispatch | Notes |
|------|----------|-------|
| Task 1: bar in `preview.ts` + CSS + tests | executor subagent + reviewer pair | reviewer PASS, no findings |
| Verification | orchestrator | re-ran vitest file run, full `npm test`, `npm run build` |
| Structure reviews | doc-standardizer, code-standardizer | run after this dispatch; results pending at authoring time |
| Close-out | documenter (this dispatch) | report, decision record, catalogs, 0.9.0 bump |

Self-implementations by the orchestrator: none.

## Choices

Candidate ledger for this run. One decision record (`docs/artifacts/choices/2026-11-09-typst-error-bar-decision.md`) covers the structural cluster; the remaining candidates are minor implementation defaults recorded here, none warrants its own file.

1. In-pane sticky bar as the error surface (chosen) over a wrapper column or an absolute overlay. Decision record.
2. Bar placed as the first child of `#preview` with `position: sticky; top: 0` instead of absolute positioning: `#preview` is the scroll container, so the bar pins while pages scroll and occupies its own flow space (no overlap, no positioning anchor needed). Decision record.
3. Full-bleed via `margin: 0 -16px` canceling the pane padding, instead of adding a wrapper or changing `#preview` padding. Decision record.
4. `+N` count badge rendered only when more than one error is present; the badge span stays in the DOM and is emptied otherwise (simpler than conditional DOM surgery, pinned by test 2).
5. Full error text exposed through the native `title` attribute rather than a custom tooltip (zero JS, matches "lazy" bar).
6. Dismiss button built in TypeScript (`type="button"`, `aria-label="Dismiss error"`) instead of adding markup to `index.html`.
7. Banner element cached in a module-level variable and invalidated with an `isConnected` check, rather than re-querying the DOM or recreating on every render (regression-pinned by test 5).
8. The `file:` prefix stays gated on `lastCompileRoot` (unchanged behavior, carried `ponytail:` note).
9. Only the first error is shown in the bar text; the rest surface as a count (full error list explicitly out of scope per spec).
10. Theme-aware colors moved from inline styles into the `#preview-error` block in `src/styles.css`, including a `[data-theme="dark"]` override matching the `.plot-error` red pair.
11. Rust payload unchanged (`TypstError { message, line, file }`); warnings remain dropped by the backend. Carried constraint in the decision record.
12. Version bumped as a minor: 0.8.0 -> 0.9.0 (the plan's stated 0.7.2 -> 0.8.0 was stale; see Plan deviations).
13. `[Unreleased]` CHANGELOG section added rather than cutting a release section; tagging stays user-invoked.
14. Decision record created as a new entry with status `active`; no existing decision row superseded.
