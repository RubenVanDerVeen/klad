# Design: White, more visible cursor in dark theme

Date: 2026-10-02
Status: approved (single-pass)

## Problem

User reports the editor caret is hard to see in the dark theme (appears black).

## Current state (recon, 2026-10-02)

- All editor theming is plain CSS in `src/styles.css`; no `EditorView.theme()` anywhere.
- Dark override exists: `[data-theme="dark"] .cm-cursor { border-left-color: #e6e6e9; }` (`src/styles.css:275`).
- Native `caret-color` is unset repo-wide. CodeMirror normally draws the caret via `.cm-cursor` (border-left), but the native caret path (e.g. over native selection/widgets, or if drawing is bypassed) falls back to browser default; effectively black.
- Theme switching sets `data-theme` on `documentElement` (`src/main.ts:125`); rule scoping is correct.
- No CSS test infra; no tests touch cursor.

Diagnosis: either the drawn-cursor color reads as too dim (`#e6e6e9` vs near-black bg is visible, but user disagrees) and/or the native caret path renders black. Fix both with one rule change; do not chase further.

## Decision

Force a pure white caret in dark theme via the existing CSS block:

1. Bump drawn cursor to `#ffffff`: `[data-theme="dark"] .cm-cursor { border-left-color: #fff; }`
2. Cover the native path: add `[data-theme="dark"] .cm-content { caret-color: #fff; }`

### Alternatives considered

- **Keep `#e6e6e9`**; rejected: user explicitly reports low visibility.
- **`EditorView.theme()` API**; rejected: repo convention is CSS overrides; bigger diff, zero benefit.

## Non-goals

- Light theme untouched (CM default black on white is fine).
- No new dependency, no theme compartment, no tests for a color literal.

## Acceptance

- Dark theme: caret renders white (drawn `.cm-cursor` and native `caret-color` both `#fff`).
- Light theme: unchanged.
- `npm test` green; `vite build` succeeds.

## Versioning

Fix → patch bump. Canonical source `src-tauri/tauri.conf.json` → `version`; sync `package.json` and `src-tauri/Cargo.toml`. CHANGELOG: no `[Unreleased]` section exists; create one above `## [0.7.1]` and record the fix (per Keep a Changelog).
