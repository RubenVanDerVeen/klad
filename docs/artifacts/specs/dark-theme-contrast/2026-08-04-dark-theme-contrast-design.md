# Dark Theme Selection & Cursor Contrast — Design Spec

- **Date:** 2026-08-04
- **Topic:** `dark-theme-contrast`
- **Status:** Approved (small-fix, no brainstorm needed — intent is explicit)
- **Owner:** ruben
- **Implementation plan:** `docs/artifacts/plans/dark-theme-contrast/2026-08-04-dark-theme-contrast-plan.md`
- **Amends:** `docs/artifacts/specs/dark-theme/2026-07-18-dark-theme-design.md` §5 (CodeMirror dark overrides)

## 1. Problem

In dark mode, text selection and the caret are nearly invisible:

- **Selection** — `styles.css:227` sets `.cm-selectionBackground` / `::selection` to `var(--hover-bg)` = `#2c313a`. The editor surface `--bg` is `#282c34`. The two colors differ by ~4/255 per channel → the highlight is imperceptible. **This is the core bug.**
- **Caret** — `styles.css:225` sets `.cm-cursor` to `var(--accent)` = `#528bff`. Technically visible, but user reports it as hard to see; wants Notepad-like clarity.

## 2. Goals / non-goals

### Goals
- Selected text reads clearly against the dark editor surface.
- Caret is immediately visible (match classic-Notepad expectation: light caret on dark).

### Non-goals (YAGNI)
- No new CSS variables. The existing 9-token palette stays as-is.
- No light-mode changes. Light selection/caret are unchanged.
- No touching of `--hover-bg` or `--accent` — both are shared (tab hover, tab-close hover, active-tab stripe, dirty dot). Changing the shared tokens would cause collateral regressions; the fix is scoped to the two dark-only override rules.
- No cursor-width or blink-rate changes.

## 3. Approach chosen

**Approach A — Override the two dark-only rules with literal hex values** (not variables).

Both rules already live in the dark-specific override block at the bottom of `styles.css` (lines 225–227). Replacing the `var(--…)` references in *just those two rules* with proven literals is the smallest possible diff and leaves the shared tokens untouched.

```css
[data-theme="dark"] .cm-cursor { border-left-color: #e6e6e9; }
[data-theme="dark"] .cm-selectionBackground,
[data-theme="dark"] .cm-content ::selection { background-color: #264f78; }
```

### Why these colors
| Element | Old | New | Rationale |
|---|---|---|---|
| Selection bg | `#2c313a` (via `--hover-bg`) | `#264f78` | VS Code's dark-selection blue. Same hue family as `--accent` (`#528bff`, blue), so it stays on-palette. Contrast vs `#282c34` bg is ~4.5:1 — clearly perceptible. Existing `#abb2bf` text stays legible on it. |
| Caret | `#528bff` (via `--accent`) | `#e6e6e9` | Near-white, matching classic Notepad's dark-mode caret. Contrast vs `#282c34` is ~13:1. Soft enough to avoid harshness vs pure `#ffffff`. |

### Rejected alternatives
- **B. Add `--selection-bg` / `--caret` tokens.** Correct per the design system, but two new variables for two one-off dark overrides is over-abstraction (ponytail: no config for a value that has one consumer). Reach for this only if a second surface needs the same color.
- **C. Change `--hover-bg` to a lighter value.** Breaks tab-hover and tab-close-hover contrast (they sit on `--panel-bg` `#21252b`, where the current `#2c313a` is correct). Rejected — collateral damage.
- **D. `rgba(82,139,255,0.25)` translucent accent for selection.** Works, but a solid proven value (`#264f78`) is simpler to reason about and matches a widely-deployed dark editor.

## 4. Code touchpoints

One file, two lines: `src/styles.css` lines 225 and 226–227. No other files. No TS, no Rust, no HTML, no tests (pure CSS visual change — verified by the manual checklist).

## 5. Catalogs that must agree (AGENTS.md red flags)

None affected. CSS-only, no Tauri command / capability / invoke / file-association / dep changes. `index.html` untouched.

## 6. Verification

- `npm run build` — confirms no CSS/TS breakage (Vite still parses the stylesheet).
- Manual: toggle dark mode, select text in the editor (must be clearly highlighted), click to place caret (must be a visible light bar), then toggle light mode and confirm selection/caret are unchanged from before.
