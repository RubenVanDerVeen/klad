# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

---

## [Unreleased]

Work in progress for upcoming milestones.

### Added: pending

- _TBD_

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
[0.1.0]: #01102026-07-17
