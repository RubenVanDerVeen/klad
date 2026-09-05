# Klad: Agent Context

## Overview
- Tier: medium.

Klad is a cross-platform Notepad replacement for Windows and Linux with live Markdown and Typst preview. It is a single-author Tauri 2 application with a vanilla TypeScript frontend and Rust backend.

## Key Facts
- **Frontend:** Vite 6, vanilla TypeScript, CodeMirror 6, Vitest.
- **Backend:** Rust 2021 in `src-tauri/`; Tauri commands are registered in `main.rs`.
- **Encoding:** editor buffers are always LF-normalized; EOL conversion happens only during save.
- **Labels:** encoding labels cross the Rust/TypeScript boundary verbatim.
- **Preview:** Markdown uses `marked` + `dompurify`; Typst uses embedded compilation and SVG output.
- **UI:** native DOM and `<dialog>`; do not introduce React or Svelte.
- **Tests:** `npm test` and `cd src-tauri && cargo test`.

## Git & Workflow
- Repo: `https://github.com/RubenVanDerVeen/klad.git`
- **No commit/push without explicit user instruction.**
- **Carve-out:** with an approved spec and plan under `docs/artifacts/features/<feature>/`, plan execution may commit at specified task or phase boundaries.
- Default to `feat/<scope>` for non-trivial features; small fixes and docs may use the default branch.
- Commit messages use Conventional Commits 1.0.0.
- Tracked `commit-msg` hook at `.githooks/commit-msg` enforces Conventional Commits. Activate per clone with `git config core.hooksPath .githooks`. Emergency bypass: `git commit --no-verify`.
- Changelog uses Keep a Changelog 1.1.0; releases use SemVer 2.0.0.

### Versioning
- **Canonical source:** `src-tauri/tauri.conf.json` -> `version`.
- **Sync targets:** `package.json` -> `version`, `src-tauri/Cargo.toml` -> `[package].version`.
- **Policy:** SemVer 2.0.0; release policy is defined by the project-standardization versioning reference.
- **Trigger:** release cutting is deliberate and updates `[Unreleased]` in `CHANGELOG.md`.
- **Last release:** `v0.3.0` - 2026-08-02.

## Components
| Area | Location | Purpose |
|------|----------|---------|
| Frontend | `src/` | Editor, tabs, menus, preview, dialogs, settings |
| Backend | `src-tauri/src/` | File I/O, encoding, EOL, Typst, Tauri commands |
| Packaging | `src-tauri/` | Tauri configuration, ACL, bundle targets |
| Tests | `src/__tests__/`, Rust inline tests | Frontend and backend verification |

## On-demand Context
| File | Purpose |
|------|---------|
| `.agents/todolist.md` | Pending improvements |
| `docs/artifacts/features/` | Specs, plans, reports (one folder per feature) |
| `docs/artifacts/reviews/` | Reviews and audits (flat log) |

## Artifacts
`docs/artifacts/features/<feature>/` is canonical for specs/plans/reports (one folder per feature; suffix signals type, e.g. `-design.md`, `-plan.md`, `-report.md`). Reviews and audits live in the flat `docs/artifacts/reviews/` log; do not bury them inside a feature folder. Use `YYYY-MM-DD-<topic>-<type>.md`. Do not create `docs/superpowers/`, `.planning/`, or extra siblings under `docs/artifacts/`. Historical `specs/`, `plans/`, and `multi-plans/` are being migrated into `features/<feature>/`; do not add new files to them.

## Knowledge graph (graphify)
`graphify-out/` holds a queryable AST-only code graph. If `graphify-out/graph.json` exists, query it before grep/glob/Read for architecture or cross-file questions with `graphify query`. Refresh with `graphify update .` when stale.

## Adding features, modules, or components
Update every applicable catalog in the same change:
- `src-tauri/src/main.rs`: Tauri command registration.
- `src/fileio.ts`: frontend IPC wrappers.
- `src-tauri/tauri.conf.json`: file associations and bundle configuration.
- `src-tauri/capabilities/default.json`: new permissions.
- `package.json` and `src-tauri/Cargo.toml`: dependency catalogs.
- `index.html`: dialog markup referenced by frontend code.
- `README.md`, `CHANGELOG.md`, and this component table when user-visible behavior changes.

Stop if a new item is missing from a catalog or catalogs disagree.
