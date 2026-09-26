# CSV Editor + Viewer — Design

Date: 2026-09-26
Status: approved (single-pass)
Feature folder: `docs/artifacts/features/csv-editor/`

## Summary

Klad gains first-class `.csv` support following the exact pattern `.md` and `.typ` already use: a CSV file opens as an editable plain-text tab (existing CodeMirror buffer — CSV is text, the editor needs no changes) and the preview pane shows a live, clean HTML table view of the buffer. Parse is frontend, sync, dependency-free.

## Goals

1. Opening a `.csv` file auto-shows the preview pane with a rendered table (like `.md` today).
2. Typing in the text buffer updates the table live (debounced, same as markdown's 150 ms).
3. Correct RFC 4180 parsing: quoted fields, `""` escapes, commas/newlines inside quotes, CRLF input.
4. Clean output: first row as table header, escaped cells, no script injection.
5. Works on malformed input without data loss (viewer is read-only projection of the text buffer; buffer is the source of truth).

## Non-goals (YAGNI, revisit only on request)

- Table-cell editing (edit stays in the text buffer).
- Delimiter preference in settings — sniffed per file instead.
- CodeMirror CSV syntax highlighting (no language packages exist in this repo).
- Sort/filter/search in the table view.
- Export (CSV→other formats).

## Decisions

### D1: Parse in TypeScript, no new dependency

Options considered:
- **TS parser in `src/csv.ts` (chosen):** ~40-line RFC 4180 state machine. Sync like `renderMarkdown`, no IPC, no race guard, trivially unit-testable with the repo's existing pure-function vitest style.
- Rust `csv` crate command: crate is already in the tree transitively (via typst-library), but adds an IPC round trip per keystroke, async race handling (typst needed `renderToken` for this), and a new command + registration + wrapper for what 40 lines do in-process.

### D2: Editor is the existing plain-text buffer

No `editor.ts` changes. The text buffer is authoritative; the table is a projection. Guarantees no CSV edit ever corrupts quoting — the user edits raw text, same as today.

### D3: Delimiter sniffing, per file

`sniffDelimiter(text)`: scan the first non-empty line (quote-aware), count `,` `;` `\t` `|`, pick the most frequent; ties/default → `,`. No settings field, no menu item.

### D4: First row is the header

Rendered as `<th>` (existing `#preview table` CSS applies). Assumption noted; a toggle is future work if ever needed.

### D5: Render cap

Files with more than 5,000 data rows render the first 5,000 plus a visible note "… N more rows (preview truncated)". Guards the DOM against multi-hundred-MB CSVs. Text buffer and save path are unaffected (full file always saved).

## Architecture

New module `src/csv.ts` — pure functions, no DOM:

```ts
export function sniffDelimiter(text: string): string;        // , ; \t | — default ,
export function parseCsv(text: string, delim: string): string[][]; // RFC 4180, lenient on unclosed quotes
```

Parser contract:
- Handles `"` quoting, `""` escape, embedded commas/newlines/CRLF; `\r\n` and `\n` both row-terminators; trailing newline does not produce an empty row.
- Lenient: an unclosed quote consumes to EOF as a field (matches how text editors treat partial files); never throws.
- Empty line between rows → empty row (preserves user-visible structure); parser never drops data silently.

Integration (mirrors typst dispatch, all frontend):

1. `src/main.ts` — add `isCsv(m)` (`/\.(csv)$/i`, beside `isMarkdown`/`isTypst`); extend `applyPreviewMode` kind resolution so `.csv` resolves kind `"csv"`; add `csv` to `FILTERS` open/save list.
2. `src/preview.ts` — extend `PreviewKind` to `"md" | "typ" | "csv"`; in `updatePreview` give `csv` the fast (150 ms) debounce like md; in `renderPreviewNow` add branch: `sniffDelimiter` → `parseCsv` → build `<table>` HTML with escaped cells (no DOMPurify needed — cells are text-escaped at build time; only trusted structural markup is templated), apply render cap, set `pane().innerHTML`.
3. `src/styles.css` — reuse existing `#preview table` styles; add only what the truncation note needs (small muted line).

Data flow: buffer text → `updatePreview(text)` → sniff → parse → escaped table HTML → preview pane. Same lifecycle as markdown (shown/hidden by `applyPreviewMode` on every tab transition; scroll sync is generic and works unchanged).

Error handling: parser never throws; unclosed quotes render best-effort. No error banner path needed (unlike typst, nothing can fail at runtime).

## Packaging / catalogs (same change, per AGENTS.md)

- `src-tauri/tauri.conf.json`: add file association `{ "ext": ["csv"], "name": "CSV File", "description": "CSV File", "mimeType": "text/csv", "role": "Editor" }`.
- `README.md`: mention CSV live table preview.
- `CHANGELOG.md`: `[Unreleased]` → Added entry.
- No Rust changes; no `main.rs`/`fileio.ts`/`package.json`/`Cargo.toml` changes.

## Versioning

`src-tauri/tauri.conf.json` is canonical (AGENTS.md). Shipped work is a `feat` → expected bump **minor** (0.3.0 → 0.4.0) at release-cut time; documenter ship-bumps at close-out per policy.

## Testing

- `src/__tests__/csv.test.ts`: pure-function tests for `parseCsv` (quotes, `""`, embedded comma/newline/CRLF, trailing newline, unclosed quote, empty fields, delimiter variants) and `sniffDelimiter` (`;`-file, tab-file, default `,`, quote-masked separators).
- `src/__tests__/` may gain a path→kind test mirroring `typst-preview.test.ts` pattern if the mapping is testable without exporting from `main.ts` (mirror allowed, same precedent).
- Verify: `npm test`. Rust untouched → `cargo test` expected green unchanged, run anyway as regression check.
