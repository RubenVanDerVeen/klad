# SP-1 verification — 2026-07-16

Headless dev environment (Windows, no Tauri WebView). Items marked PASS were
executed in this environment; items requiring GUI interaction are DEFERRED
with a note.

## Headless run

- [x] `npm test`, `cargo test` (src-tauri/), `npx tsc --noEmit` all green
      - vitest: 2 files, 7 tests passed (`document.test.ts`, `settings.test.ts`)
      - tsc --noEmit: exit 0, no diagnostics
      - cargo test: 12 passed, 0 failed
        (fs_cmds: detects_eol, read_normalizes_crlf_and_reports_it,
         save_applies_crlf, utf8_bom_roundtrip, detects_utf16_le_bom,
         detects_utf16_be_bom, detects_windows_1252, utf16_le_roundtrip,
         utf16_be_roundtrip, saves_windows_1252_label,
         unmappable_chars_become_entities_in_1252, read_missing_file_errors)

## Encoding round-trips (byte-level, via cargo tests above)

- [x] Open UTF-16 LE file → status bar shows UTF-16 LE, text correct
      Evidence: `detects_utf16_le_bom` writes `[0xFF,0xFE] + "héllo" UTF-16 LE`,
      reads back `text="héllo"`, `encoding="UTF-16 LE"`.
      DEFERRED: actual status bar UI render.
- [x] Switch encoding UTF-8 → UTF-16 LE, save, reopen → still UTF-16 LE
      Evidence: `utf16_le_roundtrip` saves "één\nregel" as UTF-16 LE / CRLF,
      re-reads, `encoding="UTF-16 LE"`, `eol="CRLF"`.
- [x] Switch EOL CRLF → LF, save → file has LF only
      Evidence: `read_normalizes_crlf_and_reports_it` (CRLF → LF in memory),
      and `utf16_be_roundtrip` / `saves_windows_1252_label` exercise the `save_file` LF pass-through (`text` written verbatim).
      Note: No single cargo test asserts the full CRLF-on-disk → LF-on-disk cycle; the GUI dropdown interaction is the real verification.

## GUI / manual (DEFERRED — needs `npm run tauri dev` on a GUI host)

- [ ] Ctrl+F find with match highlighting; F3 next
- [ ] Ctrl+H replace one and replace-all work
- [ ] Ctrl+G jumps to line
- [ ] Word wrap toggle wraps a 500-char line; checkmark tracks state
- [ ] Zoom via menu, Ctrl+=/-/0, Ctrl+wheel; status bar % follows; clamped at 10/500
- [ ] Font change applies and persists
- [ ] File → Print… opens print dialog
- [ ] Settings survive app restart
