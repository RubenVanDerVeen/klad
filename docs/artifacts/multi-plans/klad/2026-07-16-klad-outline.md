# Klad Decomposition Outline

Cross-platform (Windows + Linux) Notepad replacement. Tauri v2 (Rust shell + system webview). Simple notepad-level editor; `.md` gets live split preview; installers register file associations so it takes over as default text editor.

## Foundation (F — shared, runs first)

- What it is: Tauri v2 scaffold + app shell everything else plugs into. Window with menu bar, editor area, status-bar placeholder, and a (hidden) preview-pane slot. Document model (`path, text, encoding, eol, dirty`). File I/O: New / Open / Save / Save As (UTF-8 only), open file passed as CLI arg, dirty-marker in title, unsaved-changes guard on close. Editor core component chosen and wired (decided in foundation spec: CodeMirror 6 vs plain textarea).
- Scope boundaries: IN — scaffold, layout shell, document model, basic UTF-8 file I/O, menu skeleton. NOT — find/replace, encodings beyond UTF-8, markdown rendering, installers/associations.
- Depended on by: SP-1, SP-2, SP-3.

## Sub-projects (run in parallel after foundation)

### SP-1: Editor essentials
- Goal: Everything classic Notepad does beyond open/save: find/replace (case, wrap-around), go-to-line, word-wrap toggle, zoom, font setting, status bar (ln/col, encoding, EOL, zoom), encoding detect + save-as (UTF-8, UTF-16 LE/BE, Windows-1252), EOL detect/convert (CRLF/LF), recent files, settings persistence (JSON).
- Why independent: pure editor/status-bar surface + Rust file-I/O extension behind the foundation's document-model interface.
- Depends on: F.
- Touches: frontend editor + status bar modules, Rust encoding I/O, settings file.

### SP-2: Markdown live split preview
- Goal: For `.md` files, toggleable split view — source left, rendered right, re-renders (debounced) while typing. CommonMark + GFM tables/task lists, sanitized output, basic proportional scroll sync.
- Why independent: lives entirely in the preview-pane slot; only reads document text.
- Depends on: F.
- Touches: preview pane module, md render dependency.

### SP-3: Packaging & OS integration
- Goal: Installers that take over Notepad's place. Windows: NSIS installer via tauri-bundler, file associations (.txt .md .log .ini .cfg) + Default Programs registration. Linux: .deb + AppImage, .desktop with `text/plain;text/markdown`, xdg-mime defaults, icons. App icon set.
- Why independent: config/bundler/resources surface; no app-code overlap with SP-1/SP-2.
- Depends on: F (uses its CLI-arg file open).
- Touches: src-tauri config, bundler resources, icons, install docs.

## Execution order
1. F on `feat/klad`
2. SP-1 (`feat/klad/sp-1-editor`), SP-2 (`feat/klad/sp-2-preview`), SP-3 (`feat/klad/sp-3-packaging`) in parallel
3. Integration verification on `feat/klad`
