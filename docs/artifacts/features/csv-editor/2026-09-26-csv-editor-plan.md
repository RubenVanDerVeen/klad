# CSV Editor + Viewer — Implementation Plan

Spec: `docs/artifacts/features/csv-editor/2026-09-26-csv-editor-design.md`
Branch: `feat/csv-preview` (create from current default branch before Task 1).
Verify commands: `npm test` (frontend). Rust untouched; run `cd src-tauri && cargo test` once at the end as regression.
Versioning: canonical source `src-tauri/tauri.conf.json`; this is a `feat` → expected bump **minor** (0.3.0 → 0.4.0) applied at close-out by the documenter.

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `src/csv.ts` | Create | Pure RFC 4180 parser + delimiter sniffer. No DOM, no imports. |
| `src/__tests__/csv.test.ts` | Create | Vitest unit tests for the parser and sniffer. |
| `src/__tests__/typst-preview.test.ts` | Modify | Extend `previewKindForPath` mirror with csv cases. |
| `src/preview.ts` | Modify | New `"csv"` preview kind + table renderer branch. |
| `src/main.ts` | Modify | `.csv` path dispatch, kind→`setPreviewKind` wiring, open/save filter. |
| `src/styles.css` | Modify | One `.csv-note` rule for the truncation notice. |
| `src-tauri/tauri.conf.json` | Modify | `.csv` file association. |
| `README.md` | Modify | User-visible feature mention. |
| `CHANGELOG.md` | Modify | `[Unreleased]` Added entry. |
| `AGENTS.md` | Modify | Preview fact line in Key Facts. |

---

### Task 1: CSV parser module (`src/csv.ts`)

**Files:**
- Create: `src/csv.ts`
- Create: `src/__tests__/csv.test.ts`

**Depends:** none

**Interfaces:**
- Consumes: nothing (standalone pure module).
- Produces:
  - `sniffDelimiter(text: string): string` — returns one of `","` `";"` `"\t"` `"|"`; default `","`.
  - `parseCsv(text: string, delim: string): string[][]` — RFC 4180, lenient on unclosed quotes, never throws.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/csv.test.ts` (plain vitest, no jsdom — pure functions):

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, sniffDelimiter } from "../csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\nd,e,f", ",")).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("treats CRLF as a row terminator", () => {
    expect(parseCsv("a,b\r\nc,d", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("trailing newline does not create an empty row", () => {
    expect(parseCsv("a,b\n", ",")).toEqual([["a", "b"]]);
  });

  it("parses quoted fields with commas, newlines and escaped quotes", () => {
    expect(parseCsv('a,"x,y","li""ne"\n"multi\nline",b', ",")).toEqual([
      ["a", "x,y", 'li"ne'],
      ["multi\nline", "b"],
    ]);
  });

  it("keeps empty fields and empty rows", () => {
    expect(parseCsv("a,,c\n\nd,e", ",")).toEqual([
      ["a", "", "c"],
      [""],
      ["d", "e"],
    ]);
  });

  it("keeps a trailing empty field after a final delimiter", () => {
    expect(parseCsv("a,b,", ",")).toEqual([["a", "b", ""]]);
  });

  it("is lenient on unclosed quotes (consumes to EOF, never throws)", () => {
    expect(parseCsv('a,"unclosed', ",")).toEqual([["a", "unclosed"]]);
  });

  it("supports alternate delimiters", () => {
    expect(parseCsv("a;b\nc;d", ";")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseCsv("", ",")).toEqual([]);
  });
});

describe("sniffDelimiter", () => {
  it("picks semicolon when it dominates", () => {
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
  });
  it("picks tab when it dominates", () => {
    expect(sniffDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
  it("defaults to comma", () => {
    expect(sniffDelimiter("a b c\n1 2 3")).toBe(",");
  });
  it("ignores separators inside quotes", () => {
    expect(sniffDelimiter('"a;b",c\n"1;2",3')).toBe(",");
  });
  it("sniffs from the first non-empty line", () => {
    expect(sniffDelimiter("\n\na|b\n1,2")).toBe("|");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../csv` (module does not exist yet).

- [ ] **Step 3: Implement `src/csv.ts`**

```ts
// Minimal RFC 4180 CSV parsing. Pure functions, no DOM, no deps.
// Lenient by design: unclosed quotes consume to EOF, input is never rejected.

const DELIMS = [",", ";", "\t", "|"] as const;

function countOutsideQuotes(line: string, d: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === d && !inQuotes) count++;
  }
  return count;
}

/** Pick the delimiter that occurs most often (outside quotes) on the first non-empty line. */
export function sniffDelimiter(text: string): string {
  let line = "";
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (raw.trim() !== "") {
      line = raw;
      break;
    }
  }
  let best = ",";
  let bestCount = 0;
  for (const d of DELIMS) {
    const count = countOutsideQuotes(line, d);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Parse CSV text into rows of string fields. Never throws; never drops rows. */
export function parseCsv(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delim) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }
    field += c;
    i++;
  }
  // Trailing newline must not produce a phantom empty row; a trailing
  // delimiter must keep its final empty field.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test`
Expected: PASS (all new `csv.test.ts` cases green, existing tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/csv.ts src/__tests__/csv.test.ts
git commit -m "feat(csv): add RFC 4180 parser and delimiter sniffer"
```

---

### Task 2: Preview integration + dispatch

**Files:**
- Modify: `src/preview.ts` (kind union ~line 21, `updatePreview` ~line 116, `renderPreviewNow` ~line 102)
- Modify: `src/main.ts` (`isCsv` beside `isMarkdown`/`isTypst` at 178-184, `applyPreviewMode` 186-194, `FILTERS` 35-38)
- Modify: `src/styles.css` (append one rule near the `#preview table` block, ~line 144-157)

**Depends:** Task 1

**Interfaces:**
- Consumes: `sniffDelimiter(text: string): string` and `parseCsv(text: string, delim: string): string[][]` from `src/csv.ts` (Task 1).
- Produces: `.csv` files resolve preview kind `"csv"` and render a table into the `#preview` pane; nothing exported for other tasks.

- [ ] **Step 1: Extend the existing kind-mirror test**

One mirror already exists: `previewKindForPath` in `src/__tests__/typst-preview.test.ts:7-11` (main.ts doesn't export the mapping). Extend it — do not create a second mirror. Update the mirror's return type and add csv cases:

```ts
// in src/__tests__/typst-preview.test.ts
function previewKindForPath(path: string | null): "md" | "typ" | "csv" | null {
  if (/\.(md|markdown)$/i.test(path ?? "")) return "md";
  if (/\.(typ|typst)$/i.test(path ?? "")) return "typ";
  if (/\.csv$/i.test(path ?? "")) return "csv"; // add
  return null;
}
```

Add to the existing describe block (or a sibling one in the same file):

```ts
it("routes .csv to the csv kind", () => {
  expect(previewKindForPath("data.csv")).toBe("csv");
  expect(previewKindForPath("DATA.CSV")).toBe("csv");
});
it("does not treat .csv-in-name as csv", () => {
  expect(previewKindForPath("backup.csv.bak")).toBe(null);
});
```

These pass trivially against the mirror — they are a drift-guard for `main.ts`, not TDD fuel. The real gates are Step 5's `npx tsc --noEmit` + `npm test` plus the manual smoke at plan end.

- [ ] **Step 2: Wire dispatch in `src/main.ts`**

Below `isTypst` (around line 184) add:

```ts
function isCsv(m: DocMeta): boolean {
  return /\.csv$/i.test(m.path ?? "");
}
```

In `applyPreviewMode` (lines 186-194) two changes:

a) the kind resolution becomes:

```ts
const kind: PreviewKind | null = isMarkdown(m) ? "md" : isTypst(m) ? "typ" : isCsv(m) ? "csv" : null;
```

b) the `setPreviewKind` call (currently `setPreviewKind(kind === "typ" ? "typ" : "md")` at ~line 191 — csv would fall into the md arm) becomes:

```ts
setPreviewKind(kind ?? "md");
```

In `FILTERS` (lines 35-38) add `csv` to the Text files extension list:

```ts
const FILTERS = [
  { name: "Text files", extensions: ["txt", "md", "markdown", "log", "ini", "cfg", "typ", "typst", "csv"] },
  { name: "All files", extensions: ["*"] },
];
```

- [ ] **Step 3: Add the csv render branch in `src/preview.ts`**

No debounce change needed: `updatePreview` (~line 116) already routes any non-`"typ"` kind to the 150 ms markdown debounce, so csv takes the fast path for free. Changes:

1. Extend the union (line ~21):

```ts
export type PreviewKind = "md" | "typ" | "csv";
```

2. In `renderPreviewNow` (~line 102), add the csv branch first — `hideErrorBanner()` must run here so a stale typst error banner from a previous tab doesn't linger over the table:

```ts
if (previewKind === "csv") {
  hideErrorBanner();
  pane().innerHTML = renderCsvTable(text);
  return;
}
```

3. Add at module scope in `preview.ts`:

```ts
import { parseCsv, sniffDelimiter } from "./csv";

const MAX_CSV_ROWS = 5000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCsvTable(text: string): string {
  const rows = parseCsv(text, sniffDelimiter(text));
  if (rows.length === 0) return "";
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const pad = (r: string[]): string[] => {
    const out = r.slice(0, cols);
    while (out.length < cols) out.push("");
    return out;
  };
  const head = pad(rows[0]);
  const body = rows.slice(1);
  let html =
    "<table><thead><tr>" +
    head.map((h) => `<th>${escapeHtml(h)}</th>`).join("") +
    "</tr></thead><tbody>";
  for (const row of body.slice(0, MAX_CSV_ROWS)) {
    html +=
      "<tr>" +
      pad(row)
        .map((cell) => `<td>${escapeHtml(cell)}</td>`)
        .join("") +
      "</tr>";
  }
  html += "</tbody></table>";
  if (body.length > MAX_CSV_ROWS) {
    html += `<p class="csv-note">… ${(body.length - MAX_CSV_ROWS).toLocaleString()} more rows (preview truncated)</p>`;
  }
  return html;
}
```

Cells are escaped at build time, so only trusted structural markup reaches `innerHTML` — no DOMPurify needed for this branch.

- [ ] **Step 4: Add truncation-note style in `src/styles.css`**

Append after the existing `#preview table` rules (~line 157). Opacity-based so it works in both themes without new variables:

```css
#preview .csv-note {
  opacity: 0.7;
  font-size: 0.85em;
  margin-top: 4px;
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: compile clean, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/preview.ts src/styles.css src/__tests__/typst-preview.test.ts
git commit -m "feat(preview): live CSV table view for .csv files"
```

---

### Task 3: Packaging + docs catalogs

**Files:**
- Modify: `src-tauri/tauri.conf.json` (file associations block, lines ~36-43)
- Modify: `README.md`
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added)
- Modify: `AGENTS.md` (Preview fact in Key Facts)

**Depends:** Task 2

**Interfaces:**
- Consumes: shipped behavior from Task 2 (`.csv` opens with table preview) so docs match reality.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Register the file association**

In `src-tauri/tauri.conf.json`, add to the `fileAssociations` array, same shape as the existing entries:

```json
{ "ext": ["csv"], "name": "CSV File", "description": "CSV File", "mimeType": "text/csv", "role": "Editor" }
```

- [ ] **Step 2: Update docs**

- `README.md`: in the feature list, add one bullet: "Live CSV table preview for `.csv` files (delimiter auto-detected, first row as header)."
- `CHANGELOG.md`: under `[Unreleased]` → `### Added`, add: `- Live CSV table preview: opening a `.csv` file renders the buffer as a table with auto-detected delimiter (`,;\t|`), quoted-field support, and a 5,000-row preview cap.`
- `AGENTS.md`: update the Preview bullet in Key Facts to: `- **Preview:** Markdown uses `marked` + `dompurify`; Typst uses embedded compilation and SVG output; CSV renders a table via `src/csv.ts` (frontend parse, no IPC).`

- [ ] **Step 3: Verify**

Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('ok')"`
Expected: `ok` (config still valid JSON).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json README.md CHANGELOG.md AGENTS.md
git commit -m "docs(csv): register .csv association and document table preview"
```

---

## Final verification (orchestrator, after all tasks)

1. `npm test` — all green.
2. `cd src-tauri && cargo test` — green, unchanged (no Rust edits in this plan).
3. `npx tsc --noEmit` — clean.
4. Manual smoke (user-facing, non-blocking): open a `.csv` with quotes/semicolons in the running app, confirm table renders, edit a cell in the text buffer, confirm table updates.

## Self-review

- Spec coverage: parser (T1), dispatch+preview+cap+styles (T2), association+docs (T3), versioning noted at top, testing commands per task. Non-goals respected — no settings field, no editor changes, no new deps.
- Placeholders: none; all steps carry complete code.
- Type consistency: `sniffDelimiter`/`parseCsv` signatures identical across T1 produces and T2 consumes; `PreviewKind` union extended in T2 matches spec.
