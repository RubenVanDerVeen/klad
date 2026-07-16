# Klad SP-2: Markdown Live Split Preview — Design

Part of the klad multi-plan. Depends on the merged foundation (`feat/klad`). For `.md` files: source left, rendered right, updates while typing.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Renderer | `marked` (gfm on) + `DOMPurify` sanitize | Tiny, standard, safe; preview must never execute HTML from a file |
| Update | Debounced 150 ms on `onDocChanged` | Keystroke-latency-proof on large docs |
| Toggle | View → Markdown Preview (CheckMenuItem, Ctrl+Shift+M); auto-ON when opening/saving-as `.md`/`.markdown`, auto-OFF leaving them | Matches "it's a notepad that understands md", still user-overridable |
| Scroll sync | Proportional (editor scroll % → preview scrollTop %) | ponytail: naive proportional sync; upgrade to heading-anchor mapping if drift annoys |
| Styling | Small GitHub-lite CSS in the existing stylesheet, light theme | Matches app; theming is out of scope |
| Source highlighting | None (`@codemirror/lang-markdown` skipped) | YAGNI — preview is the requirement, add later if wanted |

## Components (touches)

```
src/render.ts    NEW — renderMarkdown(text): string  (marked + DOMPurify, pure, testable)
src/preview.ts   NEW — show()/hide()/toggle()/isVisible()/update(text) over the foundation's #preview div; owns debounce + scroll sync
src/menu.ts      + View → Markdown Preview CheckMenuItem (kept in sync with auto-toggle)
src/main.ts      wiring: onDocChanged→preview.update; open/new/saveAs→auto toggle by extension
src/styles.css   preview typography (headings, code blocks, tables, task-list checkboxes, blockquotes, images max-width:100%)
```

Only reads document text through existing hooks — no document-model or Rust changes.

## Error handling

`renderMarkdown` wraps marked in try/catch → on parse throw, renders the text in a `<pre>` (never a blank pane). DOMPurify strips scripts/event handlers/iframes; `target=_blank` links get `rel="noopener"`.

## Testing

- vitest on `render.ts`: GFM table → `<table>`, task list → `<input type="checkbox" disabled>`, `<script>` stripped, event-handler attrs stripped, fenced code preserved.
- vitest on debounce helper.
- Manual checklist: open `.md` → split appears; typing updates right pane; Ctrl+Shift+M toggles; `.txt` stays single-pane; scroll follows.
