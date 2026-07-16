# Klad Foundation — Design

Part of the klad multi-plan (see `docs/artifacts/multi-plans/klad/2026-07-16-klad-outline.md`). The foundation is the app shell every sub-project plugs into.

## Overview

Tauri v2 desktop app, vanilla TypeScript frontend (no UI framework), CodeMirror 6 as editor core. One window, one document — classic Notepad model (no tabs; a second launch is a second process/window).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Editor core | CodeMirror 6 | Find/replace, go-to-line, wrap toggle, ln/col come nearly free for SP-1; textarea would mean hand-rolling all of it |
| Frontend | Vanilla TS + Vite | A notepad needs no framework |
| Menu | Tauri v2 JS Menu API (`@tauri-apps/api/menu`) | Actions are plain JS callbacks; no Rust event round-trip; CheckMenuItem state stays in one language |
| File I/O | Custom Rust commands `read_file` / `save_file` | SP-1 needs raw bytes for encoding detection; interface fixed here, internals extended there |
| Save prompt | Native `<dialog>` with Save / Don't Save / Cancel | 3-button native message dialogs are version-fragile in the dialog plugin; `<dialog>` is deterministic |
| Text model | Editor text always LF-normalized; EOL style stored in doc meta, applied on save | One representation internally, Notepad-compatible output |
| Multi-window | Not supported ("New Window" omitted) | YAGNI; OS launches a new process per double-click anyway |

## Components

```
src/main.ts        bootstrap + file flows (new/open/save/saveAs/exit/close-guard/startup file)
src/editor.ts      CM6 setup; createEditor(parent, onDocChanged, onCursor), getText, setText
src/document.ts    DocMeta {path, encoding, eol, dirty}; newDoc, fileName, windowTitle, defaultEol
src/fileio.ts      typed invoke() wrappers: readFile, saveFile, getStartupFile
src/menu.ts        setupMenu(actions) — File (New/Open/Save/Save As/Exit), Edit (predefined items)
src/styles.css     layout: content row (editor + hidden #preview slot) + #statusbar placeholder
src-tauri/src/main.rs      builder, dialog plugin, command registration, get_startup_file
src-tauri/src/fs_cmds.rs   read_file → FileDoc{text, encoding, eol}; save_file(path, text, encoding, eol)
```

Interfaces the sub-projects rely on:
- `FileDoc { text, encoding, eol }` from `read_file`; foundation reads UTF-8 (lossy) only, detects EOL, normalizes text to LF. SP-1 swaps the detection internals; signature never changes.
- `createEditor(parent, onDocChanged, onCursor)` — SP-1 wires `onCursor` to the status bar, SP-2 wires `onDocChanged` to the preview.
- `#preview` div (hidden) and `#statusbar` div exist in the layout from day one so SP-1/SP-2 don't touch `index.html` structure.
- `setupMenu(actions)` — SPs extend the actions object and add submenus.

## Data flow

Menu action → flow fn in `main.ts` → (dialog plugin for pickers) → `fileio.ts` invoke → Rust command → update `DocMeta` + editor → `windowTitle()` → `getCurrentWindow().setTitle()`. Dirty flag set by CM6 `updateListener.docChanged`, cleared on save/open/new.

Close guard: `onCloseRequested` → if dirty, `preventDefault()` + `<dialog>` prompt → Save (run save flow; abort close if Save As cancelled) / Don't Save (`destroy()`) / Cancel.

Startup: frontend invokes `get_startup_file` (first CLI arg if it's an existing file) and opens it — this is what file associations (SP-3) hit.

## Error handling

Rust commands return `Result<_, String>`; frontend shows failures in a small `<dialog>` alert (`showError(msg)` helper in main.ts, reused by SPs). No silent failures; a failed save never clears the dirty flag.

## Testing

- vitest: `document.ts` pure functions (fileName across `\` and `/` paths, windowTitle dirty marker, eol default).
- cargo test: `detect_eol`, read/save round-trip via temp file, CRLF applied on save.
- UI wiring: manual dev-run checklist (final plan task) — this is a desktop app; no WebDriver harness (deliberate: heavy for a notepad).

## Out of scope (foundation)

Encodings beyond UTF-8 (SP-1), find/replace/wrap/zoom/status bar contents (SP-1), markdown preview (SP-2), bundling/associations/icons (SP-3), tabs, printing (one-liner added in SP-1), session restore.
