# Report: Resizable & Collapsible Panels

Spec: `2026-10-06-panel-resize-collapse-design.md`
Plan: `2026-10-06-panel-resize-collapse-plan.md`
Branch: `feat/panel-resize-collapse`, cut from `main`. Date: 2026-10-06.

## Summary

The sidebar (file tree) and preview columns are now resizable via drag handles between the panes, and the sidebar collapses via `View > Toggle Sidebar`. Column widths and sidebar visibility persist across restarts under the `klad-ui` localStorage key. Implementation is a new `src/uilayout.ts` module (tolerant parse + splitter drag logic, no new dependencies) plus handle markup in `index.html`, width-variable CSS in `src/styles.css`, and menu/startup wiring in `src/menu.ts` / `src/main.ts`. Shipped as v0.8.0 (minor bump: `feat` scope under 0.x policy).

## Branch and commits

| Hash | Subject |
|------|---------|
| `d7df596` | docs: spec and plan for panel resize and collapse |
| `ff729c0` | feat(ui): pane handle markup and column width CSS |
| `ee31a79` | feat(ui): panel layout state module with splitters |
| `a60e38e` | feat(ui): toggle sidebar menu item, splitter wiring, layout persistence (amended: closeFolder sidebar state sync) |
| `5b9da81` | docs(ui): changelog and readme for panel resize and collapse |
| `c513adb` | chore(release): v0.8.0 |
| (this commit) | docs: execution report for panel resize and collapse |

## Files changed

Per commit (diff stat vs `main`: 8 files, +1022/-5, plus close-out files):

- `d7df596`: `docs/artifacts/features/panel-resize-collapse/2026-10-06-panel-resize-collapse-design.md`, `...-plan.md` (new)
- `ff729c0`: `index.html`, `src/styles.css`
- `ee31a79`: `src/uilayout.ts`, `src/__tests__/uilayout.test.ts` (new)
- `a60e38e`: `src/main.ts`, `src/menu.ts`
- `5b9da81`: `CHANGELOG.md`, `README.md`
- `c513adb`: `src-tauri/tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (own-package version entry), `CHANGELOG.md` (rename `[Unreleased]` to `[0.8.0] - 2026-10-06` + link ref)
- this commit: this report, `docs/artifacts/choices/2026-10-06-panel-resize-collapse-decision.md`, `docs/artifacts/choices/index.md`

No Rust source, Tauri command, capability, or dependency changes; `src-tauri/` touches are version strings only.

## Verification

- `npm test`: PASS - 16/16 test files, 133/133 tests (re-run at close-out on the final tree; includes the 13 new `src/__tests__/uilayout.test.ts` cases).
- `npm run build`: PASS - type-check + bundle clean; only the pre-existing >500 kB chunk-size warning.
- `cd src-tauri && cargo test`: not re-run at close-out - the branch touches no Rust code (version strings only). Last known green on `main`.

## Plan deviations

Three in Task 1, all reconciling the plan's reference code toward the plan's tests (tests win; all three match design intent, confirmed in `src/uilayout.ts`):

1. `clampPaneWidth` non-finite handling: plan code returned `min` for any non-finite input, but the plan test expects `clampPaneWidth(Infinity, 140, 480) === 480`. Shipped: `Number.isNaN(w) -> min`; `Infinity` flows through the normal clamp to `max` (a huge width clamps to the ceiling).
2. `parseUiLayout` missing key: plan code mapped a missing key to `NaN -> min` clamp, but the plan test expects `parseUiLayout({}) === DEFAULT_UI_LAYOUT`. Shipped: missing/non-number field falls back to that field's default.
3. `sidebarHidden` coercion: plan code used `o.sidebarHidden === true`, but the plan test expects `{ sidebarHidden: 1 }` to parse as `true`. Shipped: `Boolean(o.sidebarHidden)`.

No other deviations. Task 2 and Task 3 followed the plan as written.

## Standardization review

- Code-standardizer (post-plan structure audit): one finding - `closeFolder` in `src/main.ts` hid the sidebar without syncing the new `sidebarItem` check state (stale checkmark). Fixed: amended into Task 3's commit (`a60e38e`) per the plan's own `menuHandles?.sidebarItem.setChecked(false)` line.
- Doc-standardizer: no findings outstanding; README/CHANGELOG coverage was deferred to this close-out (plan §Close-out) and is applied below.
- Remaining recommendations: none.

## Documentation updates

- `CHANGELOG.md`: `[Unreleased]` Added/Changed per plan §Close-out, then renamed to `## [0.8.0] - 2026-10-06` in the release commit; link ref added.
- `README.md`: one Features bullet - resizable sidebar/preview columns via drag handles (double-click resets), `View > Toggle Sidebar`, widths persist.
- `AGENTS.md`: no change - no new component area (`uilayout.ts` lives under Frontend), no new commands/deps/capabilities; catalogs agree.
- Choices registry: `docs/artifacts/choices/2026-10-06-panel-resize-collapse-decision.md` (pointer-event splitters over CSS-only `resize` and Split.js), indexed in `docs/artifacts/choices/index.md`. No prior entry superseded.

## Skills loaded

- Structure reviews: doc-standardizer, code-standardizer (post-plan audits).
- Close-out: release-description (v0.8.0 release notes body), documenter (this report, catalogs, ship bump).

## ponytail: deferrals

New in this run: `src/uilayout.ts:34` - shape-checked object parse, not a schema lib (same discipline as `parseSettings`). Upgrade path: a schema lib if `klad-ui` grows nested structure.

## Unverified items / left for the user

Manual smoke test (plan Task 3 Step 3, needs a display; not run headless):

1. `npm run tauri dev`
2. Drag both handles: sidebar clamps 140-480 px, preview keeps >= 240 px for the editor.
3. Double-click each handle: width resets to default (220 / 380).
4. `View > Toggle Sidebar`: tree hides/shows; menu checkmark stays truthful after Open Folder / Close Folder.
5. Restart: widths + sidebar visibility survive.
6. Collapse and re-expand the sidebar: tree expansion state intact.

Also user-invoked (deliberately not done here): `git tag -a v0.8.0` + push of the tag (CI then builds the draft release). Reuse the `chore(release): v0.8.0` commit body as the tag annotation, character-for-character. No PR per instruction.

## Dispatch Log

| Task | Dispatch | Notes |
|------|----------|-------|
| Task 1: `uilayout.ts` + tests | executor subagent + reviewer pair | 3 plan-code-vs-test reconciliations (see Plan deviations) |
| Task 2: handle markup + CSS | executor subagent + reviewer pair | none |
| Task 3: menu + startup wiring | executor subagent + reviewer pair | reviewer found closeFolder staleness; fixed via amend |
| Structure reviews | doc-standardizer, code-standardizer | close-out docs deferred by design; one code finding (fixed above) |
| Close-out | documenter (this dispatch) | report, decision record, catalogs, v0.8.0 ship bump |

Self-implementations by the orchestrator: none.
