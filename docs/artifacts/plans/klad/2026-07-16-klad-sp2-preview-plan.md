# Klad SP-2: Markdown Live Split Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.md` files get a live split view — source left, sanitized rendered Markdown right, debounced updates while typing, proportional scroll sync, View-menu/Ctrl+Shift+M toggle.

**Architecture:** `render.ts` is a pure `text → sanitized html` function (marked + DOMPurify). `preview.ts` owns the foundation's `#preview` div: visibility, debounced updates, scroll sync. `main.ts` wires the existing `onDocChanged` hook and auto-toggles by file extension.

**Tech Stack:** Adds `marked`, `dompurify` (runtime) and `jsdom` (dev, for vitest DOM tests only).

**Spec:** `docs/artifacts/specs/klad/2026-07-16-klad-sp2-preview-design.md`

## Global Constraints

- Branch: `feat/klad-sp2-preview`, created from the merged `feat/klad`. (Deviation from the manifest-template naming `feat/klad/sp-2-...`: git forbids `feat/klad/...` while branch `feat/klad` exists.)
- Do NOT change foundation signatures (`DocMeta`, `createEditor`, `read_file`/`save_file`). No Rust changes at all in this SP.
- Preview must never execute content from the file: everything through `DOMPurify.sanitize`.
- Tests: `npm test`. DOM-dependent test files carry a `// @vitest-environment jsdom` pragma; everything else stays in node env.
- Commit after every task.
- `menu.ts`, `main.ts`, `styles.css` are also touched by SP-1 — expected merge-conflict files; keep changes minimal and additive. If SP-1 merged first and `setupMenu` already returns `MenuHandles` with a View submenu, ADD the preview item to that submenu and extend `MenuHandles` with `previewItem`; the code below shows the standalone (foundation-only) variant plus the merged variant.

---

### Task 1: Markdown renderer (`render.ts`)

**Files:**
- Create: `src/render.ts`
- Test: `src/__tests__/render.test.ts`
- Modify: `package.json` (deps)

**Interfaces:**
- Consumes: nothing.
- Produces: `renderMarkdown(text: string): string` — GFM markdown in, sanitized HTML string out; never throws.

- [ ] **Step 1: Install dependencies**

Run: `npm install marked@^15 dompurify@^3` and `npm install -D jsdom@^25`
Expected: added to `package.json`.

- [ ] **Step 2: Write the failing tests**

`src/__tests__/render.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../render";

describe("renderMarkdown", () => {
  it("renders GFM tables", () => {
    const html = renderMarkdown("|a|b|\n|-|-|\n|1|2|");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders task lists as disabled checkboxes", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
  });

  it("strips script tags", () => {
    const html = renderMarkdown("hi <script>alert(1)</script>");
    expect(html).not.toContain("<script");
  });

  it("strips event handler attributes", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconst a = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("const a = 1;");
  });

  it("renders headings and inline code", () => {
    const html = renderMarkdown("# Title\n\n`code`");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<code>code</code>");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../render`.

- [ ] **Step 4: Implement `src/render.ts`**

```ts
import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(text: string): string {
  let html: string;
  try {
    html = marked.parse(text, { async: false }) as string;
  } catch {
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    html = `<pre>${escaped}</pre>`;
  }
  return DOMPurify.sanitize(html);
}
```

Note: marked emits task-list checkboxes with `disabled` already; if the `disabled` assertion fails, check marked's changelog for the current attribute shape and adjust the assertion to what marked actually emits (the requirement is: checkbox present, not interactive).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all render tests + existing tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/render.ts src/__tests__/render.test.ts
git commit -m "feat: sanitized GFM markdown renderer"
```

---

### Task 2: Preview pane module (`preview.ts`)

**Files:**
- Create: `src/preview.ts`
- Test: `src/__tests__/debounce.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `#preview` div (foundation), `renderMarkdown` (Task 1).
- Produces: `debounce<T>(fn, ms)`, `isPreviewVisible(): boolean`, `setPreviewVisible(on: boolean): void`, `updatePreview(text: string): void` (debounced 150 ms), `renderPreviewNow(text: string): void`, `syncPreviewScroll(scroller: HTMLElement): void`.

- [ ] **Step 1: Write the failing debounce test**

`src/__tests__/debounce.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { debounce } from "../preview";

describe("debounce", () => {
  it("collapses rapid calls into the last one", () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const fn = debounce((s: string) => calls.push(s), 150);
    fn("a");
    fn("b");
    fn("c");
    vi.advanceTimersByTime(149);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(calls).toEqual(["c"]);
    vi.useRealTimers();
  });
});
```

Run: `npm test` — Expected: FAIL (cannot resolve `../preview`).

- [ ] **Step 2: Implement `src/preview.ts`**

```ts
import { renderMarkdown } from "./render";

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function pane(): HTMLElement {
  return document.getElementById("preview")!;
}

let visible = false;

export function isPreviewVisible(): boolean {
  return visible;
}

export function setPreviewVisible(on: boolean): void {
  visible = on;
  pane().hidden = !on;
}

export function renderPreviewNow(text: string): void {
  if (visible) pane().innerHTML = renderMarkdown(text);
}

export const updatePreview: (text: string) => void = debounce(renderPreviewNow, 150);

export function syncPreviewScroll(scroller: HTMLElement): void {
  // ponytail: proportional scroll sync; upgrade to heading-anchor mapping if drift annoys
  const p = pane();
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (max <= 0) return;
  const ratio = scroller.scrollTop / max;
  p.scrollTop = ratio * (p.scrollHeight - p.clientHeight);
}
```

- [ ] **Step 3: Add preview typography to `src/styles.css`**

```css
#preview {
  line-height: 1.6;
  font-size: 15px;
}
#preview h1,
#preview h2 {
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 0.3em;
}
#preview code {
  background: #f0f0f0;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: Consolas, monospace;
  font-size: 85%;
}
#preview pre {
  background: #f6f6f6;
  padding: 12px;
  overflow: auto;
  border-radius: 6px;
}
#preview pre code {
  background: none;
  padding: 0;
}
#preview table {
  border-collapse: collapse;
}
#preview th,
#preview td {
  border: 1px solid #d0d0d0;
  padding: 4px 10px;
}
#preview blockquote {
  border-left: 4px solid #d0d0d0;
  margin-left: 0;
  padding-left: 12px;
  color: #555;
}
#preview img {
  max-width: 100%;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test` — Expected: PASS.
Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/preview.ts src/__tests__/debounce.test.ts src/styles.css
git commit -m "feat: preview pane module with debounce and scroll sync"
```

---

### Task 3: Wiring — menu toggle, auto-detect, live updates

**Files:**
- Modify: `src/menu.ts`, `src/main.ts`

**Interfaces:**
- Consumes: everything above; foundation `setupMenu`/`MenuActions`, `loadIntoEditor`, `onDocChanged` callback, `view.scrollDOM`.
- Produces: `MenuActions` gains `togglePreview(on: boolean): void`; `setupMenu` returns `{ previewItem: CheckMenuItem }` (merged with SP-1's `MenuHandles` if present).

- [ ] **Step 1: Extend `src/menu.ts`**

If SP-1 is already merged (setupMenu has a View submenu and returns `MenuHandles`): add to `MenuActions`:
```ts
togglePreview(on: boolean): void;
```
add to `MenuHandles`:
```ts
previewItem: CheckMenuItem;
```
and inside the View submenu items, after the zoom entries, append:
```ts
      await PredefinedMenuItem.new({ item: "Separator" }),
      previewItem,
```
where `previewItem` is created before the submenu (same pattern as SP-1's `wrapItem`):
```ts
  let previewItem: CheckMenuItem | undefined;
  previewItem = await CheckMenuItem.new({
    id: "mdPreview",
    text: "Markdown Preview",
    accelerator: "CmdOrCtrl+Shift+M",
    checked: false,
    action: async () => actions.togglePreview(await previewItem!.isChecked()),
  });
```
and return it in the handles object.

If SP-1 is NOT merged yet (foundation-only `menu.ts`): create a View submenu holding just `previewItem`, place it after the Edit submenu in `Menu.new({ items: [...] })`, change `setupMenu` to return `Promise<{ previewItem: CheckMenuItem }>`, and import `CheckMenuItem` from `@tauri-apps/api/menu`. Everything else identical.

- [ ] **Step 2: Wire `src/main.ts`**

Imports:
```ts
import {
  isPreviewVisible,
  renderPreviewNow,
  setPreviewVisible,
  syncPreviewScroll,
  updatePreview,
} from "./preview";
```

Helper + auto-toggle (place near `loadIntoEditor`):
```ts
function isMarkdown(m: DocMeta): boolean {
  return /\.(md|markdown)$/i.test(m.path ?? "");
}

function applyPreviewMode(): void {
  const on = isMarkdown(meta);
  setPreviewVisible(on);
  if (on) renderPreviewNow(getText(view));
  void menuHandles.previewItem.setChecked(on);
}
```

Call `applyPreviewMode()`:
- at the end of `loadIntoEditor` (covers Open, New, and startup file),
- at the end of the successful `doSaveAs` path (extension may have changed to/from `.md`).

In the `onDocChanged` callback passed to `createEditor`, add:
```ts
updatePreview(getText(view));
```
(after the dirty-flag logic — `getText` is already imported by the foundation).

Menu action wiring — add to the `setupMenu(...)` actions object:
```ts
togglePreview: (on) => {
  setPreviewVisible(on);
  if (on) renderPreviewNow(getText(view));
},
```
and capture the returned handles: `const menuHandles = await setupMenu({...})` (SP-1 already introduced `menuHandles` — just ensure `previewItem` is in it).

Scroll sync (after editor creation):
```ts
view.scrollDOM.addEventListener("scroll", () => {
  if (isPreviewVisible()) syncPreviewScroll(view.scrollDOM);
});
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` && `npm test` — clean/green.
Run: `npm run tauri dev` and check:
- Open a `.md` file → split view appears automatically, right pane rendered.
- Type `# Hello` → right pane shows the heading ~150 ms after you stop typing.
- Ctrl+Shift+M hides the pane; checkmark follows; toggling back re-renders current text.
- Open a `.txt` → single pane.
- Save As `notes.md` from a `.txt` buffer → preview turns on.
- Paste a long document, scroll the editor → preview follows proportionally.
- Paste `<script>alert(1)</script>` in a `.md` → no alert, script not rendered.

- [ ] **Step 4: Commit**

```bash
git add src/menu.ts src/main.ts
git commit -m "feat: live markdown split preview with auto-toggle"
```

---

### Task 4: SP-2 verification checklist

**Files:**
- Create: `docs/artifacts/verification/klad-sp2-checklist.md`

- [ ] **Step 1: Run and record**

```markdown
# SP-2 verification — YYYY-MM-DD

- [ ] `npm test`, `npx tsc --noEmit` green
- [ ] .md open → auto split; .txt open → no split
- [ ] Live update while typing (debounced, no lag on a 1000-line doc)
- [ ] GFM: table, task list, fenced code, strikethrough render
- [ ] Ctrl+Shift+M + View menu toggle, checkmark synced
- [ ] Save As across .txt/.md boundary toggles preview both directions
- [ ] Scroll sync follows editor
- [ ] <script>, <img onerror> in file → inert in preview
```

- [ ] **Step 2: Fix failures, then commit**

```bash
git add docs/artifacts/verification/klad-sp2-checklist.md
git commit -m "test: sp-2 verification checklist results"
```

---

## Self-review notes (already applied)

- Spec coverage: renderer+sanitize (T1), pane/debounce/scroll/CSS (T2), toggle/auto-detect/live wiring (T3), checklist (T4). Source markdown highlighting deliberately skipped per spec.
- Both merge orders (SP-1 first or SP-2 first) are covered in Task 3 Step 1 — the agent picks the branch state it actually sees.
- Type consistency: `updatePreview`/`renderPreviewNow`/`setPreviewVisible`/`isPreviewVisible`/`syncPreviewScroll` names match between Tasks 2 and 3.
