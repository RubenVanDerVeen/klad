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
  const previewMax = p.scrollHeight - p.clientHeight;
  if (previewMax <= 0) return;
  p.scrollTop = ratio * previewMax;
}
