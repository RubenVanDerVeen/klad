# Klad SP-1: Editor Essentials — Design

Part of the klad multi-plan. Depends on the merged foundation (`feat/klad`). Everything classic Notepad does beyond open/save.

## Scope

Find/replace, go-to-line, word wrap, zoom, font setting, status bar, encoding support, EOL convert, settings persistence. **Scope trim vs outline:** recent-files list dropped — classic Notepad has none (noted deliberately, not forgotten).

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Find/replace/go-to-line | `@codemirror/search` (`searchKeymap`, `openSearchPanel`, `gotoLine`) | Complete, tested panel for free; only needs CSS to fit the app |
| Encoding detection | BOM sniff first, then `chardetng` + `encoding_rs` | Industry-standard (Firefox) detection pair |
| Encoding labels (exact strings) | `UTF-8`, `UTF-8 BOM`, `UTF-16 LE`, `UTF-16 BE`, `Windows-1252` | Fixed vocabulary shared by Rust, status bar, and tests |
| UTF-16 encode | Manual `encode_utf16()` + BOM | `encoding_rs` encoders don't emit UTF-16 |
| Encoding/EOL change UI | `<select>` dropdowns in the status bar; changing marks doc dirty, applied on next save | Native save dialogs can't host an encoding dropdown like MS Notepad's |
| Settings persistence | `localStorage` (wrap, zoom, font family/size) | Zero Rust, survives restarts. ponytail: webview storage — move to a JSON file in app-config dir if it ever gets wiped by webview data clearing |
| Font picker | `<dialog>` with preset family dropdown (Consolas, Cascadia Code, Courier New, Segoe UI, monospace) + size input | System font enumeration isn't worth it for a notepad |
| Printing | File → Print = `window.print()` | Free with a webview |

## Components (touches)

```
src/editor.ts      + search extension, wrap/zoom/font compartments-and-CSS-vars, toggle fns
src/statusbar.ts   NEW — ln/col, encoding <select>, eol <select>, zoom %; onChange callbacks
src/settings.ts    NEW — load()/save() over localStorage with defaults {wrap:true, zoom:100, fontFamily:'Consolas', fontSize:14}
src/menu.ts        + Edit (Find…, Replace…, Go to Line…), View (Word Wrap ✓, Zoom In/Out/Reset), Format (Font…), File (Print…)
src/main.ts        wiring: onCursor→statusbar, statusbar changes→DocMeta+dirty, settings boot-load
src-tauri/src/fs_cmds.rs   read_file internals → detection; save_file → encode per label; deps encoding_rs + chardetng
```

## Behavior details

- **Read:** BOM (EF BB BF → UTF-8 BOM; FF FE → UTF-16 LE; FE FF → UTF-16 BE) else chardetng over full buffer → decode; valid UTF-8 stays `UTF-8`; legacy single-byte reports `Windows-1252`. After decode: detect EOL (`\r\n` anywhere → CRLF), then normalize `\r\n`→`\n` and stray `\r`→`\n`.
- **Save:** apply EOL, then encode per label (BOM written for `UTF-8 BOM` / UTF-16 variants; `Windows-1252` via encoding_rs lossy — unmappable chars become `?`).
- **Zoom:** 10%-500%, Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel; scales editor font-size CSS var; status bar shows %.
- **Word wrap:** CheckMenuItem, `EditorView.lineWrapping` in a `Compartment`; default on (like Notepad 11).
- **Status bar:** `Ln X, Col Y  |  [encoding ▾]  |  [CRLF ▾]  |  100%`.

## Error handling

Undecodable bytes never crash: chardetng always yields a decodable encoding (lossy decode as last resort). Encoding change + save failure keeps dirty flag (foundation rule).

## Testing

- cargo test: detection per encoding (fixture byte arrays), save/read round-trip per label, EOL normalize/apply, 1252 lossy `?` fallback.
- vitest: settings defaults/merge on corrupt JSON, zoom clamp fn.
- Manual checklist: panels, shortcuts, wrap, zoom, font, dropdown-change→dirty→save→reopen.
