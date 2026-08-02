# Klad: Agent Notes

Context for AI coding agents following the [agents.md](https://agents.md) convention (opencode, Codex, Cursor, Aider, GitHub Copilot, Hermes). Claude Code requires the `CLAUDE.md` shim at repo root that `@import`s this file. Loaded automatically each session. Start here.

## What this is

Klad is a cross-platform Notepad replacement (Windows + Linux) with live Markdown preview: Tauri 2 shell, vanilla TypeScript frontend, Rust backend. Single author, one cohesive product. Persona: classic-Notepad users who want instant startup + correct encodings + GFM preview.

## Stack

- **Tauri 2**: shell, IPC, packaging. Identifier `dev.ruben.klad`; bundle targets `nsis` (Win), `deb` + `appimage` (Linux).
- **Frontend**: vanilla TypeScript (no React/Svelte), Vite 6, CodeMirror 6. Entry `src/main.ts` orchestrates modules (`document`, `editor`, `fileio`, `menu`, `preview`, `render`, `settings`, `statusbar`, `dialogs`).
- **Backend**: Rust 2021 in `src-tauri/src/`. `main.rs` registers Tauri commands; `fs_cmds.rs` has file/encoding/EOL logic + inline tests.
- **Tests**: frontend `vitest` (`src/__tests__/`), backend `cargo test` (inline `#[cfg(test)]` in `fs_cmds.rs`). Run both before claiming done.
- **Preview**: `marked` + `dompurify` (GFM), split pane.

## Critical conventions

### Editor buffer is always LF-normalized
- `read_file` normalizes CRLF/CR → `\n` before text reaches the editor. CRLF is a **save-time** concern driven by `meta.eol`. Never store CRLF in the CodeMirror buffer; apply it only in `save_file` on write.

### Encoding labels are a cross-process contract
- Label strings (`"UTF-8"`, `"UTF-8 BOM"`, `"UTF-16 LE"`, `"UTF-16 BE"`, `"windows-1252"`, …) flow Rust ↔ TS **verbatim** via `FileDoc.encoding`. Changing casing/spelling breaks round-trips; the status-bar dropdown must emit the same strings. Detection order: BOM → UTF-8 fallback → `chardetng`/`encoding_rs` (legacy defaults to windows-1252).

### Tauri 2 command + permission wiring
- Every new `#[tauri::command]` in Rust must also be added to the `invoke_handler![...]` list in `src-tauri/src/main.rs`, **and** exposed via a wrapper in `src/fileio.ts`. Miss either half → silently does nothing.
- New capabilities/permissions go in `src-tauri/capabilities/default.json` (Tauri 2 ACL).

### Preview auto-toggle
- `applyPreviewMode()` in `main.ts` shows the pane iff the path matches `/\.(md|markdown)$/i`; the menu checkbox must stay in sync via `menuHandles?.previewItem.setChecked(on)`. Adding a previewable extension touches both.

### No web framework
- UI uses native `<dialog>` + direct DOM. `index.html` holds dialog markup referenced by id from `main.ts`/`openFontDialog`. Don't introduce React/Svelte.

### Settings & release builds
- Settings persist in browser `localStorage` (frontend only); the Rust side has no settings concept.
- `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` in `main.rs` hides the console on Windows release builds — don't remove. Icons regenerate via `npm run make-icon` (sharp) from `icon.svg`.

## Adding features, modules, or components

When you add a feature/module/component, update **every catalog that lists the existing set in the same commit**:

- `src-tauri/src/main.rs` — `invoke_handler![...]` list (every Tauri command)
- `src/fileio.ts` — frontend `invoke()` wrappers (one per command)
- `src-tauri/tauri.conf.json` — `bundle.fileAssociations` (when adding a file type)
- `src-tauri/capabilities/default.json` — permissions (when a new capability is needed)
- `package.json` deps + `src-tauri/Cargo.toml` deps — keep both halves consistent when a concern spans frontend/backend
- `index.html` — dialog markup referenced by id from `main.ts`

Red flags (any one = stop and fix before committing):
- A new Tauri command compiles in Rust but the frontend call is missing or unregistered.
- The user had to remind you to update one of the catalogs above.
- Two catalogs disagree about the same item.

## Git & workflow

- **No commit/push without explicit user instruction.** Default: every commit waits for the user.
- **Carve-out: spec/plan-driven development and execution.** When an approved spec (`docs/artifacts/specs/`) + plan (`docs/artifacts/plans/`) pair exists and the agent is executing that plan, the agent commits on its own volition at the plan's task/phase boundaries. Outside an approved plan, the default rule applies.
- **Default to a feature branch** for features: `feat/<scope>` or `plan-<name>`, cut from latest `main`. Small fixes (typos, single-line tweaks, dep bumps, docs) can land on `main`.
- Commit messages: Conventional Commits 1.0.0 (`<type>(<scope>): <description>`). Scope = module (e.g. `feat(preview)`, `fix(encoding)`), never the discipline ("frontend"/"backend").
- **Bundle related changes into a single commit.** One logical change = one commit.
- Releases: push a `v*` tag; CI builds Windows + Linux artifacts into a draft GitHub release. Branch model: `main` with short-lived `feat/<scope>` feature branches cut from latest `main`.

## Artifacts

Specs, plans, reviews live in `docs/artifacts/{specs,plans,reviews}/` (filename `YYYY-MM-DD-<topic>-<type>.md`). This project also uses `docs/artifacts/multi-plans/klad/` (outline + manifest, from `multi-plan-orchestration`) and `docs/artifacts/reviews/` for SDD execution checklists (`klad-sp<N>-checklist.md`). When delegating to `superpowers:brainstorming`/`writing-plans` or GSD, name the canonical `docs/artifacts/...` path; never let `docs/superpowers/` or `.planning/` land here. If one does, `git mv` it into `docs/artifacts/`.
