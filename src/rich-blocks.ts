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