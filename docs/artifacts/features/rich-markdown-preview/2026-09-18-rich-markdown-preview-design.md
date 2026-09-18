# Rich Markdown Preview — Design

Date: 2026-09-18
Status: Approved scope (full console flavor + image resolution)

## Goal

Klad's Markdown preview gains the hermes-console Markdown flavor:

1. **KaTeX math** — `$...$` inline, `$$...$$` block.
2. **Mermaid diagrams** — ` ```mermaid ` fences.
3. **Plots** — ` ```plot ` fences with the console's function-plot JSON syntax.
4. **Columns** — ` ```columns ` fences split on `||` lines.
5. **Image scaling** — `![alt](path){100%}` suffix syntax.
6. **Relative image resolution** (pre-existing gap) — local images actually render.

A document written for the console must render identically in Klad.

## Reference implementation

Port from `C:\Users\ruben\Projects\Hobby\hermes-console\frontend\src\lib\markdown.ts`, `plot.ts`, `mermaid.ts` (marked 18, katex 0.18 + marked-katex-extension, mermaid 11, function-plot 1.25, DOMPurify — same stack klad already uses for marked/dompurify).

## Non-goals

- Console-only extras: plot legend chips, "Reset view" button, live-editor round-trip carriers (beyond the harmless `data-size` attr), PDF export path.
- Typst preview changes (Typst has its own math/diagrams).
- Network image fetching, image caching, drag-drop of images.

## Syntax specification

### Math (KaTeX)

- `$$...$$` block via `marked-katex-extension` (inline rule stripped); `$...$` inline via custom extension with the console's pandoc-style guards: opening `$` not followed by whitespace; no newline/unescaped `$` inside; closing `$` not followed by a digit; pure amounts like `$100$` stay literal. `throwOnError: false`.
- Delimiters `$`/`$$` only — no `\(...\)`.

### Mermaid

- ` ```mermaid ` fence (case-insensitive) → `<div class="mermaid" data-src="...">escaped source</div>`. Rendered after sanitization by lazy-imported `mermaid` (`securityLevel: "strict"`, `startOnLoad: false`). Theme: klad `data-theme="dark"` → mermaid `dark`, else `default`; re-render on theme flip. Parse errors → `.mermaid-error` class + visible raw source. If `data-src` was stripped by sanitizer (source contains `-->`), fall back to `textContent`.

### Plot (function-plot)

- ` ```plot ` fence → `<div class="plot" data-src="...">escaped JSON</div>`. Mounted after sanitization by lazy-imported `function-plot` (CJS `.default` unwrap shim). Per the console rules: JSON must parse (double-quoted keys, no trailing commas) or it renders as raw text with `.plot-error` styling. Defaults: `grid: true`, `width: host.clientWidth || 550`, `height: 280`, per-series color fallback from a fixed palette (d3 schemeCategory10). Interactive pan/zoom comes free from function-plot. Dark/light handled by CSS axis overrides, not JS.

### Columns

- ` ```columns ` fence; body split on lines matching `/^\|\|[ \t]*$/m`; each part recursively rendered as Markdown inside `<div class="md-col">`, wrapped in `<div class="md-columns">` (CSS grid, 2 columns, collapses to 1 on narrow widths). N separators = N columns, wrapped 2-across. All rich features work inside columns (recursion goes through the same extension set).

### Image scaling

- `![alt](src){N%}` where `0 < N <= 100` (decimals allowed) → `<img src alt style="width:N%" data-size="N%">`. Out-of-range or malformed → literal text (extension falls through).

### Image resolution

- After `renderMarkdown`, a DOM pass over `#preview img[src]` rewrites **relative** paths against the active tab's file directory via `convertFileSrc` (`@tauri-apps/api/core`). Absolute `http(s)://`, `data:`, `asset://`, and `tauri://` sources pass through untouched. Unsaved tabs (no file path) skip resolution. SVG `<img>` is safe (scripts don't run in `<img>` context).
- Requires: `app.security.assetProtocol.enable = true` with image-extension scope, and the asset-protocol capability in `src-tauri/capabilities/default.json` (verify exact permission id against Tauri 2 docs during implementation).

## Architecture

```
src/render.ts        marked.use(extensions) + DOMPurify (ADD_ATTR additions)
                     renderMarkdown(text) — unchanged signature/behavior + rich hosts
src/rich-blocks.ts   NEW: mountRichBlocks(container) → mounts .mermaid and .plot
                     hosts (lazy imports, error fallbacks, mermaid theme observer)
src/preview.ts       renderPreviewNow: innerHTML → resolveImages(pane, baseDir)
                     → mountRichBlocks(pane); baseDir from active tab file path
src/styles.css       .md-columns grid, .plot axis overrides, .mermaid/.plot error
                     styles, katex css import (`katex/dist/katex.min.css` in render.ts)
```

Key invariants:

- **Sanitize-then-mount**: marked renderers emit only plain divs with escaped text + `data-src`; DOMPurify sanitize stays the last string-level step; mermaid/function-plot SVG mounts happen on live DOM afterwards. DOMPurify `ADD_ATTR: ["data-src", "data-size", "mathvariant", "stretchy", "encoding", "target"]` (verify each is exercised).
- **KaTeX is the exception**: rendered to HTML string at parse time (like the console), surviving sanitize via allow-listed MathML attrs.
- **Race safety**: mount work checks `node.isConnected` before committing rendered SVG into the host (a newer preview render may have replaced the DOM meanwhile). Debounce timing (150 ms) unchanged.
- **Lazy loading**: mermaid and function-plot are dynamic imports only — first diagram/plot pays the cost, not app startup. Import failure = raw source stays visible.

## Error handling

| Failure | Behavior |
|---|---|
| Plot JSON invalid / function-plot throws | `.plot-error` class, raw source visible (red border/text) |
| Mermaid parse error | `.mermaid-error` class, raw source visible |
| Lazy import fails | Raw source stays visible, no crash |
| KaTeX error (bad LaTeX) | `throwOnError: false` → red error text inline |
| Unsaved tab image | src left as-is (today's behavior) |

## Testing

- **Unit (vitest, jsdom)** in `src/__tests__/render.test.ts` (extend): math inline/block emission incl. `$100$` literal guard; mermaid/plot/columns host-div emission with escaped `data-src`; columns split incl. 3-column and no-separator cases; image `{N%}` valid/invalid; DOMPurify survival of `data-src`/`data-size`; script-stripping still passes.
- **Unit** for `resolveImages`: relative → `asset://` rewrite, absolute passthrough, no-baseDir no-op (mock `convertFileSrc` or feed it a fake path helper seam).
- **Mount logic**: error-classification paths (invalid JSON → raw text) tested without importing heavy libs (seam: the JSON-validation/fallback decision is pure). Mermaid/function-plot rendering itself verified manually (visual smoke checklist in the plan).
- Existing suites stay green (`npm test`, `cd src-tauri && cargo test`).

## Catalog updates (AGENTS.md compliance)

- `package.json`: add `katex`, `marked-katex-extension`, `mermaid`, `function-plot`.
- `src-tauri/tauri.conf.json`: assetProtocol enable + scope.
- `src-tauri/capabilities/default.json`: asset protocol permission.
- `README.md`, `CHANGELOG.md` ([Unreleased]): preview flavor additions.
- No new Tauri commands (`main.rs` unchanged), no `index.html` dialogs, no `fileio.ts` changes.
