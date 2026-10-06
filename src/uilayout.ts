// Panel layout state + splitter drag logic (sidebar / editor / preview columns).

export interface UiLayout {
  sidebarWidth: number;
  previewWidth: number;
  sidebarHidden: boolean;
}

export const DEFAULT_UI_LAYOUT: UiLayout = { sidebarWidth: 220, previewWidth: 380, sidebarHidden: false };
export const SIDEBAR_MIN = 140;
export const SIDEBAR_MAX = 480;
export const PREVIEW_MIN = 200;
export const PREVIEW_MAX = 3200;
export const EDITOR_MIN = 240;

const KEY = "klad-ui";

let current: UiLayout = { ...DEFAULT_UI_LAYOUT };

export function clampPaneWidth(w: number, min: number, max: number): number {
  if (Number.isNaN(w)) return min;
  return Math.min(max, Math.max(min, Math.round(w)));
}

export function previewBounds(
  contentWidth: number,
  sidebarWidth: number,
  sidebarHidden: boolean,
): { min: number; max: number } {
  const avail = contentWidth - (sidebarHidden ? 0 : sidebarWidth) - EDITOR_MIN;
  return { min: PREVIEW_MIN, max: Math.max(PREVIEW_MIN, avail) };
}

// ponytail: shape-checked object parse, not a schema lib - same discipline as parseSettings
export function parseUiLayout(raw: unknown): UiLayout {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_UI_LAYOUT };
  const o = raw as Record<string, unknown>;
  return {
    sidebarWidth:
      typeof o.sidebarWidth === "number"
        ? clampPaneWidth(o.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX)
        : DEFAULT_UI_LAYOUT.sidebarWidth,
    previewWidth:
      typeof o.previewWidth === "number"
        ? clampPaneWidth(o.previewWidth, PREVIEW_MIN, PREVIEW_MAX)
        : DEFAULT_UI_LAYOUT.previewWidth,
    sidebarHidden: Boolean(o.sidebarHidden),
  };
}

export function loadUiLayout(): UiLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULT_UI_LAYOUT };
    current = parseUiLayout(JSON.parse(raw));
  } catch {
    current = { ...DEFAULT_UI_LAYOUT };
  }
  return { ...current };
}

export function saveUiLayout(s: UiLayout): void {
  current = { ...s };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // quota/unavailable: keep in-memory state only
  }
}

export function getUiLayout(): UiLayout {
  return { ...current };
}

export function applyUiLayout(s: UiLayout): void {
  current = { ...s };
  const content = document.getElementById("content");
  const sidebar = document.getElementById("sidebar");
  if (content) {
    content.style.setProperty("--sidebar-w", `${s.sidebarWidth}px`);
    content.style.setProperty("--preview-w", `${s.previewWidth}px`);
  }
  if (sidebar) {
    if (s.sidebarHidden) sidebar.setAttribute("hidden", "");
    else sidebar.removeAttribute("hidden");
  }
}

export function initPanelSplitters(): void {
  const content = document.getElementById("content");
  const sidebarHandle = document.getElementById("sidebar-handle");
  const previewHandle = document.getElementById("preview-handle");
  if (!content || !sidebarHandle || !previewHandle) return;

  const reset = (which: "sidebar" | "preview") => {
    const s = getUiLayout();
    if (which === "sidebar") s.sidebarWidth = DEFAULT_UI_LAYOUT.sidebarWidth;
    else s.previewWidth = DEFAULT_UI_LAYOUT.previewWidth;
    applyUiLayout(s);
    saveUiLayout(s);
  };

  const wire = (
    handle: HTMLElement,
    onMove: (e: PointerEvent) => void,
    resetSelf: () => void,
  ) => {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add("pane-resizing");
      const move = (ev: PointerEvent) => onMove(ev);
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        document.body.classList.remove("pane-resizing");
        saveUiLayout(getUiLayout());
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", resetSelf);
  };

  wire(
    sidebarHandle,
    (e) => {
      const left = content.getBoundingClientRect().left;
      const s = getUiLayout();
      s.sidebarWidth = clampPaneWidth(e.clientX - left, SIDEBAR_MIN, SIDEBAR_MAX);
      s.sidebarHidden = false;
      applyUiLayout(s);
    },
    () => reset("sidebar"),
  );

  wire(
    previewHandle,
    (e) => {
      const rect = content.getBoundingClientRect();
      const s = getUiLayout();
      const b = previewBounds(rect.width, s.sidebarWidth, s.sidebarHidden);
      s.previewWidth = clampPaneWidth(rect.right - e.clientX, b.min, b.max);
      applyUiLayout(s);
    },
    () => reset("preview"),
  );
}