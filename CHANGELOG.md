# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

---

## [Unreleased]

Work in progress for upcoming milestones.

### Added: pending

- _TBD_

---

## [0.3.0]: 2026-08-02

First tagged release (`v*` tag triggers CI to build Windows + Linux artifacts). Supersedes the untagged 0.2.0 version-string bump. Major shift from single-file to multi-tab editing.

### Added

- **Multi-tab editing** — multiple files open in one window with a tab bar; per-tab close with dirty-confirm; Next/Previous Tab cycling (`Ctrl+Tab` / `Ctrl+Shift+Tab`); Tabs menu.
- **Session restore** — unsaved untitled notes and unsaved edits to named files survive close/reopen, stashed inside Klad (never written to disk). Dirty buffers restore dirty; clean named files re-read from disk.
- **Hot exit** — closing the window silently stashes every dirty buffer, no save prompt. Per-tab close (`Ctrl+W`) keeps the classic prompt.
- **Restore on file-arg launch** — double-clicking a file when Klad isn't running opens it alongside the restored session, matching the already-running behavior.
- **Single-instance mode** — a second launch forwards its file path to the running instance and exits; no duplicate windows.
- **Dark theme** — light/dark preference with a View menu toggle (`Ctrl+Shift+L`); theme-aware CSS across editor, dialogs, and preview.
- Redesigned app icon (K document glyph).

### Fixed

- Keyboard shortcuts `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` now fire on Windows (WebView2 had swallowed them as browser shortcuts before the menu accelerator could see them).
- Files loaded programmatically no longer show a false dirty dot on open.
- Hidden inactive editors no longer claim layout space on tab switch.

---

## [0.1.0]: 2026-07-17

Initial release: cross-platform Notepad replacement with live Markdown preview (Tauri 2 + CodeMirror 6).

### Added

- Classic Notepad workflow: one window, one file, find/replace, go-to-line, word wrap, zoom, font choice.
- Encoding support: UTF-8 (±BOM), UTF-16 LE/BE, legacy windows-125x via `chardetng`; CRLF/LF switching with byte-level round-trip tests.
- Live split Markdown preview (GFM via `marked` + `dompurify`) with auto-toggle for `.md`/`.markdown`.
- File associations: `.txt`, `.md`, `.log`, `.ini`, `.cfg`.
- CI release workflow (GitHub Actions): a `v*` tag builds NSIS (Windows), `.deb` + `.AppImage` (Linux) into a draft GitHub release.

---

[Unreleased]: #unreleased
[0.3.0]: #0302026-08-02
[0.1.0]: #01102026-07-17
