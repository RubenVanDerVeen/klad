import { renderMarkdown } from "./render";
import { compileTypst, type TypstError, type TypstResult } from "./fileio";
import { parseCsv, sniffDelimiter } from "./csv";
import { mountRichBlocks } from "./rich-blocks";
import { resolveImages } from "./images";

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

// --- preview-kind state ---------------------------------------------------

export type PreviewKind = "md" | "typ" | "csv";
let previewKind: PreviewKind = "md";

export function setPreviewKind(kind: PreviewKind): void {
  previewKind = kind;
}

// --- preview base dir (for relative image resolution) -----------------------

let previewBaseDir: string | null = null;

/** Directory of the active tab's file; null for untitled tabs. */
export function setPreviewBaseDir(path: string | null): void {
  previewBaseDir = path;
}

// --- typst project provider (workspace mode) -------------------------------

export interface TypstProject {
  path: string | null;
  root: string | null;
  overrides: Record<string, string>;
}

// ponytail: function-valued so every compile reads fresh tab state; mirrors
// setPreviewBaseDir but the closure captures live views/active tab.
let typstProjectProvider: (() => TypstProject | null) | null = null;

export function setTypstProjectProvider(fn: (() => TypstProject | null) | null): void {
  typstProjectProvider = fn;
}

export function typstCompileArgs(
  text: string,
  proj: TypstProject | null,
): [string, string | null, string | null, Record<string, string>] {
  return [text, proj?.path ?? null, proj?.root ?? null, proj?.overrides ?? {}];
}

// ponytail: tracks the root passed to the most recent compile so the error
// banner can hide Source::detached's "/main.typ" file prefix in single-file mode.
let lastCompileRoot: string | null = null;

// --- visibility -----------------------------------------------------------

let visible = false;

export function isPreviewVisible(): boolean {
  return visible;
}

export function setPreviewVisible(on: boolean): void {
  visible = on;
  pane().hidden = !on;
  if (!on) hideErrorBanner();
}

// --- race guard (spec §4.2) ----------------------------------------------
// Pure helper exported for testing. A stale compile (older token) must not
// overwrite the pane after a newer compile has already applied.
export function pickRender(currentToken: number, latestToken: number): boolean {
  return currentToken === latestToken;
}

let renderToken = 0;

// --- error banner (built from TS; no index.html change) ------------------

let errorBanner: HTMLDivElement | null = null;

function errorBannerEl(): HTMLDivElement {
  if (errorBanner) return errorBanner;
  const el = document.createElement("div");
  el.id = "preview-error";
  // ponytail: inline styles — klad has no CSS file for plugin chrome; matches
  // the dialog style precedent. Upgrade to a class if a stylesheet lands.
  el.style.color = "#b00";
  el.style.background = "#fde8e8";
  el.style.borderBottom = "1px solid #f0c0c0";
  el.style.padding = "4px 8px";
  el.style.fontFamily = "var(--editor-font-family, monospace)";
  el.style.fontSize = "12px";
  el.style.whiteSpace = "pre-wrap";
  el.hidden = true;
  pane().parentElement?.prepend(el);
  errorBanner = el;
  return el;
}

function showErrorBanner(e: TypstError): void {
  // ponytail: Source::detached still interns FileId(Project, /main.typ), so
  // err.file is non-null without a workspace — gate the file prefix on root.
  const filePart = e.file != null && lastCompileRoot != null ? `${e.file}:` : "";
  const linePart = e.line != null ? `line ${e.line}: ` : "";
  const el = errorBannerEl();
  el.textContent = `${filePart}${linePart}${e.message}`;
  el.hidden = false;
}

function hideErrorBanner(): void {
  if (errorBanner) errorBanner.hidden = true;
}

// --- render paths ---------------------------------------------------------

function applyTypstResult(result: TypstResult): void {
  if (result.errors.length > 0) {
    showErrorBanner(result.errors[0]!);
    return; // keep last-good pane contents
  }
  hideErrorBanner();
  pane().innerHTML = result.pages.map((svg) => `<div class="typst-page">${svg}</div>`).join("");
}

async function renderTypstNow(text: string): Promise<void> {
  const token = ++renderToken;
  const proj = typstProjectProvider?.() ?? null;
  lastCompileRoot = proj?.root ?? null;
  const result = await compileTypst(...typstCompileArgs(text, proj));
  if (!pickRender(token, renderToken)) return; // stale; a newer render is in flight
  applyTypstResult(result);
}

export function renderPreviewNow(text: string): void {
  if (!visible) return;
  if (previewKind === "csv") {
    hideErrorBanner();
    pane().innerHTML = renderCsvTable(text);
    return;
  }
  if (previewKind === "typ") {
    void renderTypstNow(text); // fire-and-forget; race-guarded internally
    return;
  }
  // hide any typ banner from the previous tab — sync md render doesn't go through applyTypstResult
  hideErrorBanner();
  pane().innerHTML = renderMarkdown(text);
  resolveImages(pane(), previewBaseDir);
  void mountRichBlocks(pane()); // fire-and-forget; guards detached nodes itself
}

const updatePreviewMd = debounce(renderPreviewNow, 150);
const updatePreviewTyp = debounce(renderPreviewNow, 400);

export function updatePreview(text: string): void {
  if (previewKind === "typ") updatePreviewTyp(text);
  else updatePreviewMd(text);
}

export function syncPreviewScroll(scroller: HTMLElement): void {
  // ponytail: proportional scroll sync; upgrade to heading-anchor mapping if drift annoys
  const p = pane();
  const max = scroller.scrollHeight - scroller.clientHeight;
  if (max <= 0) return;
  const ratio = scroller.scrollTop / max;
  const previewMax = p.scrollHeight - p.clientHeight;
  if (previewMax <= 0) return;
  p.scrollTop = ratio * previewMax;
}

// --- csv table render -----------------------------------------------------

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
  const head = pad(rows[0]!);
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
