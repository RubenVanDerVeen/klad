import { renderMarkdown } from "./render";
import { compileTypst, type TypstError, type TypstResult } from "./fileio";

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

export type PreviewKind = "md" | "typ";
let previewKind: PreviewKind = "md";

export function setPreviewKind(kind: PreviewKind): void {
  previewKind = kind;
}

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
  const el = errorBannerEl();
  el.textContent = e.line != null ? `line ${e.line}: ${e.message}` : e.message;
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
  const result = await compileTypst(text);
  if (!pickRender(token, renderToken)) return; // stale; a newer render is in flight
  applyTypstResult(result);
}

export function renderPreviewNow(text: string): void {
  if (!visible) return;
  if (previewKind === "typ") {
    void renderTypstNow(text); // fire-and-forget; race-guarded internally
    return;
  }
  // hide any typ banner from the previous tab — sync md render doesn't go through applyTypstResult
  hideErrorBanner();
  pane().innerHTML = renderMarkdown(text);
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
