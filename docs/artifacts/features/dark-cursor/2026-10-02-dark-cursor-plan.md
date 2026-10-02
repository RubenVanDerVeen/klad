# Plan: White, more visible cursor in dark theme

Spec: `docs/artifacts/features/dark-cursor/2026-10-02-dark-cursor-design.md`
Branch: `fix/dark-cursor`, cut from default branch.
Versioning: fix → **patch bump** (canonical: `src-tauri/tauri.conf.json` → `version`; sync `package.json`, `src-tauri/Cargo.toml`; new `[Unreleased]` section in `CHANGELOG.md`; handled at close-out by documenter, not in tasks).

## Context (zero-context engineer, read this)

- Klad themes via `[data-theme="dark"]` attribute on `documentElement`; all editor styling is plain CSS in `src/styles.css`. No `EditorView.theme()` anywhere. Do not introduce it.
- CodeMirror draws the caret as a `.cm-cursor` div (color = its `border-left-color`). The browser-native caret (`caret-color` on `.cm-content`) is the second path; it is currently unset repo-wide and renders black by default.
- Existing dark override block: `src/styles.css` lines 271–277, comment on 271, cursor rule on 275 (`border-left-color: #e6e6e9`).
- No CSS test infra exists; a color-literal change is not tested. Verification = full suite green + production build succeeds.

## File Structure

One file modified. Nothing created.

- Modify: `src/styles.css` (dark-mode CodeMirror override block, line ~275)

### Task 1: White caret in dark theme

**Files:**
- Modify: `src/styles.css:271-277`

**Depends:** none

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Edit the dark override block**

In `src/styles.css`, replace line 275:

```css
[data-theme="dark"] .cm-cursor { border-left-color: #e6e6e9; }
```

with:

```css
[data-theme="dark"] .cm-cursor { border-left-color: #fff; }
[data-theme="dark"] .cm-content { caret-color: #fff; }
```

Leave the block comment on line 271 and every other rule untouched. Do not touch light-theme rules.

- [ ] **Step 2: Verify suite + build**

Run: `npm test`
Expected: all tests PASS (no test references cursor/theme CSS; suite must stay green).

Run: `npx vite build`
Expected: build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "fix(cursor): white caret in dark theme"
```

(Repo enforces Conventional Commits via `.githooks/commit-msg`; no bypass.)

## Self-review

- Spec coverage: drawn caret white (Step 1 rule 1), native caret white (Step 1 rule 2), light untouched, suite+build verified. Covered.
- Placeholders: none; exact CSS and commands given.
- Type consistency: n/a (CSS only).
- Parallel readiness: single task, `Depends: none`.
