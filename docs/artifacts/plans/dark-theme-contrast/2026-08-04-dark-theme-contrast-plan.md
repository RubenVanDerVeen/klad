# Dark Theme Selection & Cursor Contrast — Implementation Plan

**Goal:** Make selected text and the caret visible in dark mode by overriding two CSS rules.

**Spec:** `docs/artifacts/specs/dark-theme-contrast/2026-08-04-dark-theme-contrast-design.md` (read first — color choices justified there).

**Architecture:** Two literal-hex overrides in the existing dark-only CSS block at the bottom of `src/styles.css`. No variables added, no shared tokens touched.

## Global Constraints

- **CSS-only.** Touch only `src/styles.css`. No TS, no Rust, no HTML, no test files.
- **Do NOT modify `--hover-bg` or `--accent`.** They are shared by tab hover, tab-close hover, active-tab stripe, dirty dot. Edit only the two dark override rules.
- **Light mode stays byte-identical.** The rules are scoped under `[data-theme="dark"]`; light is unaffected.
- **Branch:** cut `fix/dark-theme-contrast` from latest `main` before starting. One commit on this branch.
- **Commit message:** Conventional Commits, scope = module: `fix(styles): use visible selection and caret colors in dark mode`.
- **Verify:** `npm run build` must pass; manual dark/light visual check per spec §6.

---

## Task 1 — Override dark-mode selection and caret colors

- [ ] Cut branch `fix/dark-theme-contrast` from latest `main`.
- [ ] In `src/styles.css`, edit line 225 — change the caret rule from `var(--accent)` to a literal:

  ```css
  [data-theme="dark"] .cm-cursor { border-left-color: #e6e6e9; }
  ```

- [ ] Edit lines 226–227 — change the selection rule from `var(--hover-bg)` to a literal:

  ```css
  [data-theme="dark"] .cm-selectionBackground,
  [data-theme="dark"] .cm-content ::selection { background-color: #264f78; }
  ```

- [ ] Confirm no other rule in `styles.css` was modified (`git diff` shows exactly 2 changed lines).
- [ ] Run `npm run build` — must succeed (Vite parses the stylesheet).
- [ ] Run `npm run test` — must pass unchanged (sanity; no test covers this CSS).
- [ ] Commit on `fix/dark-theme-contrast`:
  `fix(styles): use visible selection and caret colors in dark mode`

## Task 2 — Manual visual verification (report-only, no commit)

Executor can't run the GUI; **the human verifies**. Relay this checklist in the final report:

- [ ] Toggle to dark mode (View → Dark Theme). Select text in the editor → highlight must be a clear blue, text still legible.
- [ ] Click to place the caret → a light, visible vertical bar.
- [ ] Toggle back to light mode → selection and caret look as before (no regression).
- [ ] Bonus: tab hover, active-tab stripe, dirty dot unchanged (proves shared tokens were not touched).

Branch is not merged here — user merges after the visual check passes.
