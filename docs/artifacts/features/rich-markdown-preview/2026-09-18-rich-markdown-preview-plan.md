# Rich Markdown Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klad's Markdown preview gains the hermes-console flavor: KaTeX math, Mermaid diagrams, `plot` fences, `columns` fences, image `{N%}` sizing, and relative-image resolution.

**Architecture:** Port the console's proven marked-extension set (host-div `data-src` pattern) into `src/render.ts`; mount heavy renders (mermaid, function-plot) on live DOM after DOMPurify from a new `src/rich-blocks.ts`; resolve relative images via `convertFileSrc` in a new `src/images.ts`, wired through `preview.ts`/`main.ts`.

**Tech Stack:** marked 15 (installed), katex ^0.18.7, marked-katex-extension ^5.1.12, mermaid ^11.17.2, function-plot ^1.25.4, DOMPurify (installed), Tauri 2 asset protocol.

**Spec:** `docs/artifacts/features/rich-markdown-preview/2026-09-18-rich-markdown-preview-design.md`

**Porting reference (read-only, same author):** `C:\Users\ruben\Projects\Hobby\hermes-console\frontend\src\lib\markdown.ts`, `plot.ts`, `mermaid.ts`.

## Global Constraints

- Branch: `feat/rich-markdown-preview`. Conventional Commits 1.0.0 per task.
- Vanilla TS + native DOM only; no React/Svelte; UI stays in `src/` + `src/styles.css`.
- Dependency versions: `katex ^0.18.7`, `marked-katex-extension ^5.1.12`, `mermaid ^11.17.2`, `function-plot ^1.25.4` (console parity). If marked-katex-extension ^5 refuses marked 15 as peer, pick its newest major that accepts marked 15 and note the deviation in the commit body.
- Sanitize-then-mount: `DOMPurify.sanitize` stays the last string-level step in `renderMarkdown`; mermaid/function-plot SVGs mount on live DOM only.
- `ADD_ATTR: ["target", "data-src", "data-size", "mathvariant", "stretchy", "encoding"]`.
- No catalog drift (AGENTS.md): every new item lands in every applicable catalog in the same change.
- Tests: `npm test` green after every task; `cd src-tauri && cargo test` green at the end.
- If `katex` ships no bundled TS types in the installed version, add `@types/katex` as devDependency (console parity fallback).

---

### Task 1: KaTeX math (`$...$` inline, `$$...$$` block)

**Files:**
- Modify: `package.json` (npm install)
- Modify: `src/render.ts`
- Modify: `src/main.ts` (one import line at top)
- Test: `src/__tests__/render.test.ts`

**Interfaces:**
- Produces: `renderMarkdown(text: string): string` (unchanged signature) now emitting KaTeX HTML.

- [ ] **Step 1: Install dependencies**

```powershell
npm install "katex@^0.18.7" "marked-katex-extension@^5.1.12"
```

If katex lacks types: `npm install -D @types/katex`.

- [ ] **Step 2: Write failing tests** — append to the `describe` in `src/__tests__/render.test.ts`:

```ts
  it("renders inline math", () => {
    const html = renderMarkdown("Euler: $e^{i\\pi}$");
    expect(html).toContain("katex");
  });

  it("renders block math", () => {
    const html = renderMarkdown("$$\nx^2 - 2\n$$");
    expect(html).toContain("katex-display");
  });

  it("keeps pure currency amounts literal", () => {
    const html = renderMarkdown("costs $100$ today");
    expect(html).not.toContain("katex");
  });

  it("renders math glued to prose", () => {
    const html = renderMarkdown("a$x^2$b");
    expect(html).toContain("katex");
  });
```

- [ ] **Step 3: Run tests, verify the 4 new ones fail**

Run: `npm test`
Expected: 4 failures (no katex output yet).

- [ ] **Step 4: Implement** — replace `src/render.ts` contents with:

```ts
import DOMPurify from "dompurify";
import katex from "katex";
import { marked, type TokenizerAndRendererExtension } from "marked";
import markedKatex from "marked-katex-extension";

marked.setOptions({ gfm: true, breaks: false });

// --- KaTeX ($...$ inline, $$...$$ block) — ported from hermes-console
// frontend/src/lib/markdown.ts:172-234. marked-katex owns BLOCK math only;
// its inline rule is looser than mathInline below and would render
// adjacency/currency cases the flavor wants literal ("5$ and 6$", "$100$").
const katexExtension = markedKatex({ throwOnError: false }) as unknown as {
  extensions: TokenizerAndRendererExtension[];
};
katexExtension.extensions = katexExtension.extensions.filter((e) => e.level !== "inline");
marked.use(katexExtension);

// Own inline math rule, shadowing marked-katex's (stripped above, but kept
// as a separate use() for merge order). Pandoc-style guards: opening not
// followed by whitespace, no newline/unescaped $ inside, no edge spaces,
// closing $ not followed by a digit, pure amounts stay literal.
const PURE_AMOUNT_RE = /^\d+([.,]\d+)*$/;

const mathInline: TokenizerAndRendererExtension = {
  name: "mathInline",
  level: "inline",
  start(src: string) {
    for (let i = 0; i < src.length; i++) {
      if (src[i] === "$" && (i === 0 || src[i - 1] !== "\\")) return i;
    }
    return undefined;
  },
  tokenizer(src: string) {
    const open = /^(\${1,2})/.exec(src)?.[1];
    if (!open) return undefined;
    const closeIdx = src.indexOf(open, open.length);
    if (closeIdx < 0) return undefined;
    const latex = src.slice(open.length, closeIdx);
    if (latex.length === 0) return undefined;
    if (/[$\n]/.test(latex.replace(/\\\$/g, ""))) return undefined;
    if (/^\s|\s$/.test(latex)) return undefined;
    if (PURE_AMOUNT_RE.test(latex)) return undefined;
    if (/[0-9]/.test(src.charAt(closeIdx + open.length))) return undefined;
    return {
      type: "mathInline",
      raw: src.slice(0, closeIdx + open.length),
      latex,
      dollars: open.length,
    };
  },
  renderer(token) {
    const latex = String(token.latex ?? "");
    const dollars = Number(token.dollars ?? 1);
    return katex.renderToString(latex, { throwOnError: false, displayMode: dollars === 2 });
  },
};
marked.use({ extensions: [mathInline] });

const SANITIZE_ATTRS = ["target", "data-src", "data-size", "mathvariant", "stretchy", "encoding"];

export function renderMarkdown(text: string): string {
  let html: string;
  try {
    html = marked.parse(text, { async: false }) as string;
  } catch {
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    html = `<pre>${escaped}</pre>`;
  }
  return DOMPurify.sanitize(html, { ADD_ATTR: SANITIZE_ATTRS });
}
```

Add at the top of `src/main.ts` (with the other side-effect/style imports; vitest never imports main.ts, so the CSS import stays out of tests):

```ts
import "katex/dist/katex.min.css";
```

- [ ] **Step 5: Run tests, verify green**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json src/render.ts src/main.ts src/__tests__/render.test.ts
git commit -m "feat(preview): render inline and block math with KaTeX"
```

---

### Task 2: Host extensions — mermaid, plot, columns, image `{N%}`

**Files:**
- Modify: `src/render.ts`
- Test: `src/__tests__/render.test.ts`

**Interfaces:**
- Produces (consumed by Task 3/4): rendered hosts `<div class="mermaid" data-src="...">source</div>`, `<div class="plot" data-src="...">source</div>`, `<div class="md-columns"><div class="md-col">…` , `<img ... style="width:N%" data-size="N%">`.

- [ ] **Step 1: Write failing tests** — append to `src/__tests__/render.test.ts`:

```ts
  it("emits a mermaid host with visible source", () => {
    const html = renderMarkdown("```mermaid\nflowchart TD\n  A x B\n```");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("flowchart TD");
    expect(html).toContain("data-src="); // no `-->` in source, so DOMPurify keeps it
  });

  it("emits a plot host with escaped JSON", () => {
    const html = renderMarkdown('```plot\n{"data": [{"fn": "x^2"}]}\n```');
    expect(html).toContain('class="plot"');
    expect(html).toContain("data-src=");
    expect(html).toContain("&quot;fn&quot;"); // attr-escaped quotes survive
  });

  it("renders columns split on || separator lines", () => {
    const html = renderMarkdown("```columns\nleft text\n\n||\n\nright text\n```");
    expect(html).toContain('class="md-columns"');
    expect(html).toContain("<p>left text</p>");
    expect(html).toContain("<p>right text</p>");
  });

  it("renders three columns when two separators", () => {
    const html = renderMarkdown("```columns\na\n\n||\n\nb\n\n||\n\nc\n```");
    expect(html.match(/class="md-col"/g)?.length).toBe(3);
  });

  it("renders a separator-less columns fence as one column", () => {
    const html = renderMarkdown("```columns\njust text\n```");
    expect(html).toContain('class="md-col"');
  });

  it("applies percent width to images", () => {
    const html = renderMarkdown("![alt](pic.png){50%}");
    expect(html).toContain('style="width:50%"');
    expect(html).toContain('data-size="50%"');
  });

  it("keeps out-of-range image scale literal", () => {
    const html = renderMarkdown("![alt](pic.png){150%}");
    expect(html).not.toContain("data-size");
  });

  it("still strips scripts with extensions active", () => {
    const html = renderMarkdown("```mermaid\nx\n```\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<script");
  });
```

- [ ] **Step 2: Run tests, verify the 8 new ones fail**

Run: `npm test`

- [ ] **Step 3: Implement** — in `src/render.ts`, add above the KaTeX section (ported from console `markdown.ts:16-117,139-169`; cite as reference):

```ts
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const mermaidExtension: TokenizerAndRendererExtension = {
  name: "mermaid",
  level: "block",
  start(src: string) {
    return src.match(/^```mermaid[ \t]*$/mi)?.index;
  },
  tokenizer(src: string) {
    const m = /^```mermaid[ \t]*\n([\s\S]*?)\n```/i.exec(src);
    if (m) return { type: "mermaid", raw: m[0], text: m[1] };
    return undefined;
  },
  renderer(token) {
    const src = String(token.text ?? "");
    return `<div class="mermaid" data-src="${escapeAttr(src)}">${escapeHtml(src)}</div>`;
  },
};

const plotExtension: TokenizerAndRendererExtension = {
  name: "plot",
  level: "block",
  start(src: string) {
    return src.match(/^```plot[ \t]*$/mi)?.index;
  },
  tokenizer(src: string) {
    const m = /^```plot[ \t]*\n([\s\S]*?)\n```/i.exec(src);
    if (m) return { type: "plot", raw: m[0], text: m[1] };
    return undefined;
  },
  renderer(token) {
    const src = String(token.text ?? "");
    return `<div class="plot" data-src="${escapeAttr(src)}">${escapeHtml(src)}</div>`;
  },
};

const columnsExtension: TokenizerAndRendererExtension = {
  name: "columns",
  level: "block",
  start(src: string) {
    return src.match(/^```columns[ \t]*$/mi)?.index;
  },
  tokenizer(src: string) {
    const m = /^```columns[ \t]*\n([\s\S]*?)\n```/i.exec(src);
    if (m) return { type: "columns", raw: m[0], text: m[1] };
    return undefined;
  },
  renderer(token) {
    const body = String(token.text ?? "");
    // Split on every line that is exactly "||" (optional trailing spaces/tabs).
    const parts = body.split(/^\|\|[ \t]*$/m);
    const cols = parts
      .map((p) => `<div class="md-col">${marked.parse(p, { async: false }) as string}</div>`)
      .join("");
    return `<div class="md-columns">${cols}</div>`;
  },
};

const IMG_SIZE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\{(\d{1,3}(?:\.\d+)?)%\}/;

const imageSizeExtension: TokenizerAndRendererExtension = {
  name: "imageSize",
  level: "inline",
  start(src: string) {
    return src.indexOf("![");
  },
  tokenizer(src: string) {
    const m = IMG_SIZE_RE.exec(src);
    if (!m) return undefined;
    const pct = parseFloat(m[3]!);
    if (!(pct > 0 && pct <= 100)) return undefined;
    return { type: "imageSize", raw: m[0], alt: m[1], src: m[2], size: m[3] + "%" };
  },
  renderer(token) {
    const src = String(token.src);
    const alt = String(token.alt);
    const size = String(token.size);
    return (
      `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"` +
      ` style="width:${size}" data-size="${size}">`
    );
  },
};

marked.use({ extensions: [imageSizeExtension, mermaidExtension, plotExtension, columnsExtension] });
```

(This `marked.use` goes BEFORE the katex `use()` calls; extension arrays merge across calls.)

- [ ] **Step 4: Run tests, verify green**

Run: `npm test`

- [ ] **Step 5: Commit**

```powershell
git add src/render.ts src/__tests__/render.test.ts
git commit -m "feat(preview): emit mermaid, plot, columns hosts and sized images"
```

---

### Task 3: Rich-block mounting (`src/rich-blocks.ts`) + preview CSS

**Files:**
- Create: `src/rich-blocks.ts`
- Modify: `src/styles.css`
- Test: `src/__tests__/rich-blocks.test.ts`

**Interfaces:**
- Consumes: host divs from Task 2 (`div.plot[data-src]`, `div.mermaid[data-src]`).
- Produces (consumed by Task 5): `mountRichBlocks(root: HTMLElement): Promise<void>`, `parsePlotSrc(src: string): { ok: true; opts: FunctionPlotOptions } | { ok: false }`, `mermaidThemeFor(dataTheme: string | null | undefined): "dark" | "default"`.

- [ ] **Step 0: Install the render libraries (needed for `import type` + dynamic imports)**

```powershell
npm install "mermaid@^11.17.2" "function-plot@^1.25.4"
```

- [ ] **Step 1: Write failing tests** — create `src/__tests__/rich-blocks.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountRichBlocks, mermaidThemeFor, parsePlotSrc } from "../rich-blocks";

describe("parsePlotSrc", () => {
  it("accepts valid function-plot JSON", () => {
    expect(parsePlotSrc('{"data":[{"fn":"x^2"}]}').ok).toBe(true);
  });

  it("rejects trailing commas", () => {
    expect(parsePlotSrc('{"data":[1,]}').ok).toBe(false);
  });

  it("rejects comments and single quotes", () => {
    expect(parsePlotSrc('// c\n{"data":[]}').ok).toBe(false);
    expect(parsePlotSrc("{'data':[]}").ok).toBe(false);
  });

  it("rejects non-object JSON", () => {
    expect(parsePlotSrc('"x"').ok).toBe(false);
    expect(parsePlotSrc("[1,2]").ok).toBe(false);
  });
});

describe("mermaidThemeFor", () => {
  it("maps klad themes to mermaid themes", () => {
    expect(mermaidThemeFor("dark")).toBe("dark");
    expect(mermaidThemeFor("light")).toBe("default");
    expect(mermaidThemeFor(undefined)).toBe("default");
  });
});

describe("mountRichBlocks error path", () => {
  it("marks invalid plot JSON as plot-error without loading function-plot", async () => {
    document.body.innerHTML = '<div class="plot" data-src=\'{"bad": 1,}\'></div>';
    await mountRichBlocks(document.body);
    const node = document.querySelector(".plot")!;
    expect(node.classList.contains("plot-error")).toBe(true);
    expect(node.textContent).toContain('"bad"');
  });
});
```

Note: `mountRichBlocks` returns `void`; the test needs the internal promise. Export it as `async` (see implementation) so `await` works — declare `mountRichBlocks` as `async function` and `await` it in the test.

- [ ] **Step 2: Run tests, verify fail**

Run: `npm test`
Expected: module `../rich-blocks` not found.

- [ ] **Step 3: Implement** — create `src/rich-blocks.ts` (simplified port of console `plot.ts` + `mermaid.ts`: no streaming debounce/MutationObserver auto-mount, no legend chips, no reset button — non-goals in the spec):

```ts
// Mounts `div.mermaid` and `div.plot` hosts (emitted by render.ts) into live
// SVG AFTER DOMPurify ran. Heavy libs are dynamic imports: mermaid ~1 MB and
// function-plot ~150 KB load on first use, never at boot. Ported (simplified)
// from hermes-console frontend/src/lib/mermaid.ts + plot.ts.

import type { FunctionPlotOptions } from "function-plot";

// d3 schemeCategory10 — legible on dark and light backgrounds.
export const CURVE_COLORS: readonly string[] = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
];

export type PlotPlan = { ok: true; opts: FunctionPlotOptions } | { ok: false };

/** Strict JSON gate: invalid plot JSON renders as raw text, not a chart. */
export function parsePlotSrc(src: string): PlotPlan {
  try {
    const parsed = JSON.parse(src) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    return { ok: true, opts: parsed as FunctionPlotOptions };
  } catch {
    return { ok: false };
  }
}

// --- mermaid ----------------------------------------------------------------

export type MermaidTheme = "dark" | "default";

export function mermaidThemeFor(dataTheme: string | null | undefined): MermaidTheme {
  return dataTheme === "dark" ? "dark" : "default";
}

const MERMAID_CONFIG = { startOnLoad: false, securityLevel: "strict" } as const;

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let activeTheme: MermaidTheme | null = null;

function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidPromise) {
    const theme = mermaidThemeFor(document.documentElement.dataset.theme);
    activeTheme = theme;
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({ ...MERMAID_CONFIG, theme });
      return m.default;
    });
  }
  return mermaidPromise;
}

let renderSeq = 0;

export async function renderMermaidBlocks(root: ParentNode): Promise<void> {
  const pending = Array.from(
    root.querySelectorAll<HTMLElement>("div.mermaid:not([data-rendered])"),
  );
  if (pending.length === 0) return;
  let mermaid: typeof import("mermaid").default;
  try {
    mermaid = await loadMermaid();
  } catch {
    return; // bundler/offline failure: the raw source stays visible
  }
  for (const node of pending) {
    if (!node.isConnected) continue; // a newer render replaced the pane
    node.setAttribute("data-rendered", "");
    // DOMPurify strips data-src when the source contains `-->` (mXSS guard);
    // the sanitised textContent is the fallback.
    const src = node.getAttribute("data-src") ?? node.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`mmd-${Date.now().toString(36)}-${renderSeq++}`, src);
      node.innerHTML = svg;
    } catch {
      node.classList.add("mermaid-error");
      node.textContent = src;
    }
  }
}

// --- function-plot -----------------------------------------------------------

let fnPlotPromise: Promise<typeof import("function-plot").default> | null = null;

function loadFunctionPlot(): Promise<typeof import("function-plot").default> {
  if (!fnPlotPromise) {
    fnPlotPromise = import("function-plot").then(unwrapFnPlot);
  }
  return fnPlotPromise;
}

// function-plot@1.x is CJS transpiled to ESM: depending on bundler interop the
// import surfaces the plot function directly or a module object — walk .default
// at most twice.
function unwrapFnPlot(m: unknown): typeof import("function-plot").default {
  let v: unknown = m;
  for (let depth = 0; depth < 2 && v && typeof v === "object"; depth++) {
    const d = (v as { default?: unknown }).default;
    if (typeof d === "function") return d as typeof import("function-plot").default;
    v = d;
  }
  return m as typeof import("function-plot").default;
}

function renderPlotInto(
  node: HTMLElement,
  opts: FunctionPlotOptions,
  fnPlot: typeof import("function-plot").default,
): void {
  const data = (opts.data ?? []).map((d, i) => ({
    ...d,
    color: d.color ?? CURVE_COLORS[i % CURVE_COLORS.length],
  }));
  node.textContent = "";
  const target = document.createElement("div");
  target.className = "plot-target";
  node.appendChild(target);
  fnPlot({
    ...opts,
    grid: opts.grid ?? true,
    data,
    target,
    width: node.clientWidth || 550,
    height: 280,
  });
}

export async function renderPlotBlocks(root: ParentNode): Promise<void> {
  const pending = Array.from(
    root.querySelectorAll<HTMLElement>("div.plot:not([data-rendered])"),
  );
  if (pending.length === 0) return;
  let fnPlot: typeof import("function-plot").default | undefined;
  for (const node of pending) {
    if (!node.isConnected) continue;
    node.setAttribute("data-rendered", "");
    const src = node.getAttribute("data-src") ?? node.textContent ?? "";
    const plan = parsePlotSrc(src);
    if (!plan.ok) {
      node.classList.add("plot-error");
      node.textContent = src;
      continue;
    }
    try {
      fnPlot ??= await loadFunctionPlot();
      if (!node.isConnected) continue; // detached while the import resolved
      renderPlotInto(node, plan.opts, fnPlot);
    } catch {
      node.classList.add("plot-error");
      node.textContent = src;
    }
  }
}

// --- theme follow -------------------------------------------------------------

/** Re-init mermaid on theme flip, then redraw every diagram that kept its source. */
async function applyMermaidTheme(): Promise<void> {
  const next = mermaidThemeFor(document.documentElement.dataset.theme);
  if (activeTheme === null || next === activeTheme) return;
  activeTheme = next;
  const mermaid = await loadMermaid();
  mermaid.initialize({ ...MERMAID_CONFIG, theme: next });
  for (const node of document.querySelectorAll<HTMLElement>("div.mermaid[data-rendered][data-src]")) {
    node.removeAttribute("data-rendered");
  }
  void renderMermaidBlocks(document);
}

let themeObserverInstalled = false;

function ensureThemeObserver(): void {
  if (themeObserverInstalled) return;
  themeObserverInstalled = true;
  new MutationObserver(() => void applyMermaidTheme()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

// --- entry (called by preview.ts after innerHTML is set) -----------------------

export async function mountRichBlocks(root: HTMLElement): Promise<void> {
  ensureThemeObserver();
  await Promise.all([renderMermaidBlocks(root), renderPlotBlocks(root)]);
}
```

- [ ] **Step 4: Run tests, verify green**

Run: `npm test`

- [ ] **Step 5: Add CSS** — append to `src/styles.css` (after the `#preview img` rule):

```css
/* Rich preview blocks (columns, plots, mermaid) — console flavor */
#preview .md-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  align-items: start;
}
@media (max-width: 760px) {
  #preview .md-columns {
    grid-template-columns: 1fr;
  }
}
#preview .katex-display {
  overflow-x: auto;
  overflow-y: hidden;
}
#preview .mermaid svg,
#preview .plot svg {
  max-width: 100%;
}
/* function-plot draws axes black@0.1 — map to theme vars (console app.css:579) */
#preview .plot svg .x.axis path.domain,
#preview .plot svg .y.axis path.domain {
  stroke: var(--fg);
  stroke-width: 2px;
}
#preview .plot svg .tick line {
  stroke: var(--fg-muted);
  opacity: 0.35;
}
#preview .plot-error,
#preview .mermaid-error {
  border: 1px solid rgba(248, 113, 113, 0.5);
  color: #b00;
  padding: 8px 10px;
  border-radius: 4px;
  white-space: pre-wrap;
  font-family: Consolas, monospace;
  font-size: 85%;
}
[data-theme="dark"] #preview .plot-error,
[data-theme="dark"] #preview .mermaid-error {
  color: #f87171;
}
```

- [ ] **Step 6: Run full suite + typecheck**

Run: `npm test`; `npm run build`
Expected: tests pass, tsc clean.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json src/rich-blocks.ts src/styles.css src/__tests__/rich-blocks.test.ts
git commit -m "feat(preview): mount mermaid diagrams and function plots after sanitize"
```

---

### Task 4: Image resolution (`src/images.ts` + asset protocol)

**Files:**
- Create: `src/images.ts`
- Create: `src/__tests__/images.test.ts`
- Modify: `src-tauri/tauri.conf.json:22` (security object)
- Modify: `src-tauri/capabilities/default.json` (permissions array)

**Interfaces:**
- Consumes: `@tauri-apps/api/core` `convertFileSrc` (installed).
- Produces (consumed by Task 5): `dirName(path: string): string`, `resolveImageSrc(raw: string, baseDir: string | null): string`, `resolveImages(root: ParentNode, baseDir: string | null): void`.

- [ ] **Step 1: Write failing tests** — create `src/__tests__/images.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset:${p}`,
  invoke: vi.fn(),
}));

import { dirName, resolveImageSrc, resolveImages } from "../images";

describe("dirName", () => {
  it("splits windows and posix paths", () => {
    expect(dirName("C:\\Users\\ruben\\docs\\note.md")).toBe("C:/Users/ruben/docs");
    expect(dirName("/home/ruben/docs/note.md")).toBe("/home/ruben/docs");
  });
});

describe("resolveImageSrc", () => {
  const base = "C:/Users/ruben/docs";

  it("rewrites relative paths against baseDir", () => {
    expect(resolveImageSrc(".media/pic.png", base)).toBe("asset:C:/Users/ruben/docs/.media/pic.png");
    expect(resolveImageSrc("sub\\pic.png", base)).toBe("asset:C:/Users/ruben/docs/sub/pic.png");
  });

  it("passes absolute urls and schemes through untouched", () => {
    expect(resolveImageSrc("https://x.test/a.png", base)).toBe("https://x.test/a.png");
    expect(resolveImageSrc("data:image/png;base64,AAAA", base)).toBe("data:image/png;base64,AAAA");
    expect(resolveImageSrc("/abs/path.png", base)).toBe("/abs/path.png");
    expect(resolveImageSrc("D:\\other\\pic.png", base)).toBe("D:\\other\\pic.png");
  });

  it("is a no-op without a base dir", () => {
    expect(resolveImageSrc("pic.png", null)).toBe("pic.png");
  });
});

describe("resolveImages", () => {
  it("rewrites img src in a container", () => {
    document.body.innerHTML = '<img src="pic.png"><img src="https://x.test/a.png">';
    resolveImages(document.body, "C:/docs");
    const imgs = document.querySelectorAll("img");
    expect(imgs[0]!.getAttribute("src")).toBe("asset:C:/docs/pic.png");
    expect(imgs[1]!.getAttribute("src")).toBe("https://x.test/a.png");
  });

  it("is a no-op without a base dir", () => {
    document.body.innerHTML = '<img src="pic.png">';
    resolveImages(document.body, null);
    expect(document.querySelector("img")!.getAttribute("src")).toBe("pic.png");
  });
});
```

- [ ] **Step 2: Run tests, verify fail** — Run: `npm test` (module not found).

- [ ] **Step 3: Implement** — create `src/images.ts`:

```ts
import { convertFileSrc } from "@tauri-apps/api/core";

/** Directory part of a file path, forward-slashed (Windows-safe). */
export function dirName(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/");
}

/** Rewrite a markdown img src against the document's directory. Relative
 *  paths only; urls, data/asset schemes, and absolute paths pass through. */
export function resolveImageSrc(raw: string, baseDir: string | null): string {
  if (!baseDir || !raw) return raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw; // http(s):, data:, asset:, C:\
  if (raw.startsWith("/") || raw.startsWith("\\")) return raw;
  const base = baseDir.replace(/[\\/]+$/, "");
  return convertFileSrc(`${base}/${raw.replace(/^[\\/]+/, "")}`);
}

/** DOM pass: rewrite every img[src] under root (call before mounting rich blocks). */
export function resolveImages(root: ParentNode, baseDir: string | null): void {
  if (!baseDir) return;
  root.querySelectorAll("img").forEach((img) => {
    const raw = img.getAttribute("src") ?? "";
    if (raw) img.setAttribute("src", resolveImageSrc(raw, baseDir));
  });
}
```

- [ ] **Step 4: Run tests, verify green** — Run: `npm test`

- [ ] **Step 5: Enable the asset protocol** — in `src-tauri/tauri.conf.json` replace

```json
    "security": { "csp": null }
```

with

```json
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": [
          "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.svg",
          "**/*.webp", "**/*.bmp", "**/*.avif", "**/*.ico"
        ]
      }
    }
```

In `src-tauri/capabilities/default.json` add `"asset:default"` to the `permissions` array. If the app errors at startup that the permission is unknown, run `npm run tauri dev` once and read the listed valid permission identifiers — the asset-protocol default set in the installed Tauri version wins; record the deviation in the commit body.

- [ ] **Step 6: Verify backend still fine** — Run: `cd src-tauri; cargo test`
Expected: pass (config-only change, but this catches schema typos early — a broken tauri.conf fails `cargo test`'s build of the app).

- [ ] **Step 7: Commit**

```powershell
git add src/images.ts src/__tests__/images.test.ts src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat(preview): resolve relative images via the asset protocol"
```

---

### Task 5: Preview wiring (base dir + mount calls)

**Files:**
- Modify: `src/preview.ts` (md branch of `renderPreviewNow` + base-dir state)
- Modify: `src/main.ts:186-194` (`applyPreviewMode`)
- Test: `src/__tests__/preview-images.test.ts` (new)

**Interfaces:**
- Consumes: `mountRichBlocks` (Task 3), `resolveImages`, `dirName` (Task 4).
- Produces: `setPreviewBaseDir(path: string | null): void` exported from `src/preview.ts`; md renders now mount rich blocks.

- [ ] **Step 1: Write failing test** — create `src/__tests__/preview-images.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset:${p}`,
  invoke: vi.fn(),
}));

import { renderPreviewNow, setPreviewBaseDir, setPreviewVisible } from "../preview";

describe("preview image resolution wiring", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="content"><div id="preview"></div></div>';
    setPreviewVisible(true);
  });

  it("rewrites relative image src against the active base dir", () => {
    setPreviewBaseDir("C:/docs");
    renderPreviewNow("![pic](img/pic.png)");
    const img = document.querySelector("#preview img")!;
    expect(img.getAttribute("src")).toBe("asset:C:/docs/img/pic.png");
  });

  it("leaves images alone without a base dir", () => {
    setPreviewBaseDir(null);
    renderPreviewNow("![pic](img/pic.png)");
    expect(document.querySelector("#preview img")!.getAttribute("src")).toBe("img/pic.png");
  });
});
```

- [ ] **Step 2: Run tests, verify fail** — Run: `npm test` (`setPreviewBaseDir` not exported).

- [ ] **Step 3: Implement** — in `src/preview.ts`:

Add imports (top, after existing):

```ts
import { mountRichBlocks } from "./rich-blocks";
import { resolveImages } from "./images";
```

Add base-dir state (near the `previewKind` state block):

```ts
// --- preview base dir (for relative image resolution) -----------------------

let previewBaseDir: string | null = null;

/** Directory of the active tab's file; null for untitled tabs. */
export function setPreviewBaseDir(path: string | null): void {
  previewBaseDir = path;
}
```

Replace the md branch tail of `renderPreviewNow`:

```ts
  // hide any typ banner from the previous tab – sync md render doesn't go through applyTypstResult
  hideErrorBanner();
  pane().innerHTML = renderMarkdown(text);
  resolveImages(pane(), previewBaseDir);
  void mountRichBlocks(pane()); // fire-and-forget; guards detached nodes itself
```

In `src/main.ts`, extend the import from `./preview` with `setPreviewBaseDir`, add `import { dirName } from "./images";`, and in `applyPreviewMode()` insert before the `renderPreviewNow` call:

```ts
  setPreviewBaseDir(meta.path ? dirName(meta.path) : null);
```

`applyPreviewMode` runs on every tab switch, open, close, and Save As — the only paths where the active file changes — so the base dir never goes stale. `togglePreview` re-renders with the already-current base dir.

- [ ] **Step 4: Run tests, verify green** — Run: `npm test`

- [ ] **Step 5: Commit**

```powershell
git add src/preview.ts src/main.ts src/__tests__/preview-images.test.ts
git commit -m "feat(preview): wire rich blocks and image resolution into live render"
```

---

### Task 6: Docs, catalogs, full verification

**Files:**
- Modify: `README.md` (preview/feature description)
- Modify: `CHANGELOG.md` ([Unreleased] → Added)

**Interfaces:** none (docs only).

- [ ] **Step 1: README** — in the section describing the Markdown preview, extend the feature sentence to mention math (`$...$` / `$$...$$`), Mermaid diagrams, interactive function plots, columns, and image scaling (`{N%}`), plus that relative image paths resolve against the open file. Keep it to 1-2 sentences matching the existing README voice.

- [ ] **Step 2: CHANGELOG** — under `## [Unreleased]` → `### Added`:

```markdown
- Markdown preview: KaTeX math (`$...$`, `$$...$$`), Mermaid diagrams, interactive function plots (` ```plot `), two-column layouts (` ```columns `), image scaling (`{N%}`), and relative image resolution against the open file
```

- [ ] **Step 3: Full verification**

```powershell
npm test
npm run build
cd src-tauri; cargo test
```

Expected: all green.

- [ ] **Step 4: Manual smoke (dev run)** — `npm run tauri dev`, then with a scratch `test.md` verify: inline/block math; a ` ```mermaid\nflowchart TD\n  A --> B\n``` ` diagram; the spec's plot example (interactive pan/zoom); the same plot with a trailing comma (raw text + red error style); the spec's columns example; `![x](img.png){100%}`; a relative image next to an opened .md file actually displaying; theme flip re-themes mermaid and plot axes. Record results in the final report.

- [ ] **Step 5: Commit**

```powershell
git add README.md CHANGELOG.md
git commit -m "docs: describe rich markdown preview additions"
```

---

## Catalog compliance check (final gate, per AGENTS.md)

- `package.json`: katex, marked-katex-extension (Task 1), mermaid, function-plot (Task 3 Step 0) ✓.
- `src-tauri/tauri.conf.json`: assetProtocol ✓ (Task 4). No new file associations needed.
- `src-tauri/capabilities/default.json`: asset permission ✓ (Task 4).
- `src-tauri/src/main.rs`: unchanged — no new commands.
- `src/fileio.ts`: unchanged — no new IPC.
- `index.html`: unchanged — no new dialogs.
- README/CHANGELOG ✓ (Task 6).
