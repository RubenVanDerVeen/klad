import "katex/dist/katex.min.css";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { askSave, showError } from "./dialogs";
import { DocMeta, fileName, newDoc, windowTitle } from "./document";
import { createEditor, getText, setText, setWrap } from "./editor";
import { getStartupFile, listenOpenFile, readFile, saveFile } from "./fileio";
import { MenuHandles, setupMenu } from "./menu";
import { loadSession, saveSession, Session, toSession } from "./session";
import { clampFontSize, clampZoom, loadSettings, saveSettings, Settings } from "./settings";
import { initStatusBar, setCursor, setEncoding, setEol, setZoomDisplay } from "./statusbar";
import {
  isPreviewVisible,
  renderPreviewNow,
  setPreviewKind,
  setPreviewVisible,
  syncPreviewScroll,
  updatePreview,
} from "./preview";
import {
  closeTab,
  findTabByPath,
  genId,
  newCollection,
  nextTab,
  openTab,
  prevTab,
  switchTab,
  TabCollection,
  TabState,
} from "./tabs";
import { initTabBar, renderTabs, TabView } from "./tabbar";

const FILTERS = [
  { name: "Text files", extensions: ["txt", "md", "markdown", "log", "ini", "cfg", "typ", "typst"] },
  { name: "All files", extensions: ["*"] },
];

const appWindow = getCurrentWindow();
const settings: Settings = loadSettings();

interface RuntimeTab extends TabState {
  view: EditorView;
}

let coll: TabCollection = newCollection();
let runtime: RuntimeTab[] = [];
let meta: DocMeta = newDoc(); // alias of activeTab().meta; rebound on switch

function activeTab(): RuntimeTab {
  const t = runtime.find((t) => t.id === coll.activeId);
  if (!t) throw new Error("no active tab");
  return t;
}

function toTabViews(): TabView[] {
  return runtime.map((t) => ({
    id: t.id,
    label: fileName(t.meta),
    dirty: t.meta.dirty,
    active: t.id === coll.activeId,
  }));
}

function paintTabBar(): void {
  renderTabs(toTabViews());
}

function applyEditorStyle(): void {
  const root = document.documentElement.style;
  root.setProperty("--editor-font-family", settings.fontFamily);
  root.setProperty("--editor-font-size", `${(settings.fontSize * settings.zoom) / 100}px`);
}
applyEditorStyle();

function applyTheme(): void {
  document.documentElement.dataset.theme = settings.theme;
}
applyTheme();

initStatusBar({
  onEncodingChange: (encLabel) => {
    meta.encoding = encLabel;
    meta.dirty = true;
    void refreshTitle();
    paintTabBar();
  },
  onEolChange: (eol) => {
    meta.eol = eol;
    meta.dirty = true;
    void refreshTitle();
    paintTabBar();
  },
});
setZoomDisplay(settings.zoom);
setEncoding(meta.encoding);
setEol(meta.eol);

function setZoom(z: number): void {
  settings.zoom = clampZoom(z);
  applyEditorStyle();
  setZoomDisplay(settings.zoom);
  saveSettings(settings);
}

function openFontDialog(): void {
  const dlg = document.getElementById("fontDialog") as HTMLDialogElement;
  const family = document.getElementById("fontFamilySel") as HTMLSelectElement;
  const size = document.getElementById("fontSizeInput") as HTMLInputElement;
  family.value = settings.fontFamily;
  size.value = String(settings.fontSize);
  dlg.showModal();
  document.getElementById("btnFontOk")!.onclick = () => {
    settings.fontFamily = family.value;
    settings.fontSize = clampFontSize(Number(size.value) || 14);
    applyEditorStyle();
    saveSettings(settings);
    dlg.close();
    activeTab().view.focus();
  };
  document.getElementById("btnFontCancel")!.onclick = () => dlg.close();
}

function createTab(initialText: string, initialMeta: DocMeta): RuntimeTab {
  const id = genId();
  const owner: RuntimeTab = {
    id,
    meta: initialMeta,
    view: undefined as unknown as EditorView, // assigned below
  };
  const view = createEditor(
    document.getElementById("editor")!,
    () => {
      // onDocChanged: mutate the owning tab's meta, not the singleton.
      if (!owner.meta.dirty) {
        owner.meta.dirty = true;
        if (owner.id === coll.activeId) {
          void refreshTitle();
          paintTabBar();
        }
      }
      if (owner.id === coll.activeId) {
        updatePreview(getText(owner.view));
      }
    },
    (line, col) => {
      if (owner.id === coll.activeId) setCursor(line, col);
    },
    settings.wrap,
  );
  owner.view = view;
  setText(view, initialText);
  // Non-active tabs are hidden until switched to. New tabs become active below.
  view.dom.setAttribute("hidden", "");
  return owner;
}

function activeScrollDom(): HTMLElement {
  return activeTab().view.scrollDOM;
}

// Wheel-zoom: attached to #editor (capture phase so it sees events from any tab's scroller)
document.getElementById("editor")!.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(settings.zoom + (e.deltaY < 0 ? 10 : -10));
  },
  { passive: false },
);

async function refreshTitle(): Promise<void> {
  await appWindow.setTitle(windowTitle(meta));
}

function isMarkdown(m: DocMeta): boolean {
  return /\.(md|markdown)$/i.test(m.path ?? "");
}

function isTypst(m: DocMeta): boolean {
  return /\.(typ|typst)$/i.test(m.path ?? "");
}

function applyPreviewMode(): void {
  const kind: "md" | "typ" | null = isMarkdown(meta) ? "md" : isTypst(meta) ? "typ" : null;
  setPreviewVisible(kind !== null);
  // setPreviewKind must run before renderPreviewNow so the sync 'md' branch
  // dispatches correctly. For 'typ' the kind is read inside the async branch.
  setPreviewKind(kind === "typ" ? "typ" : "md");
  if (kind) renderPreviewNow(getText(activeTab().view));
  void menuHandles?.previewItem.setChecked(kind !== null);
}

function showOnly(view: EditorView): void {
  for (const t of runtime) {
    if (t.view === view) t.view.dom.removeAttribute("hidden");
    else t.view.dom.setAttribute("hidden", "");
  }
}

function switchToTab(id: string): void {
  if (coll.activeId === id) return;
  const t = runtime.find((x) => x.id === id);
  if (!t) return;
  coll = switchTab(coll, id);
  meta = t.meta;
  showOnly(t.view);
  setEncoding(meta.encoding);
  setEol(meta.eol);
  void refreshTitle();
  applyPreviewMode();
  t.view.focus();
  paintTabBar();
  scheduleSessionSave();
}

function appendAndActivate(tab: RuntimeTab): void {
  runtime.push(tab);
  coll = openTab(coll, tab);
  meta = tab.meta;
  showOnly(tab.view);
  setEncoding(meta.encoding);
  setEol(meta.eol);
  void refreshTitle();
  applyPreviewMode();
  tab.view.focus();
  paintTabBar();
  scheduleSessionSave();
}

let sessionSaveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSessionSave(): void {
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(persistSessionNow, 250);
}

function persistSessionNow(): void {
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = undefined;
  }
  // Sync unsavedText on ALL dirty tabs so the snapshot captures their latest content.
  for (const t of runtime) {
    if (t.meta.dirty) {
      t.unsavedText = getText(t.view);
    } else {
      t.unsavedText = undefined;
    }
  }
  saveSession(toSession(coll));
}

async function closeTabById(id: string): Promise<void> {
  const t = runtime.find((x) => x.id === id);
  if (!t) return;
  // If dirty, show the tab and prompt.
  if (t.meta.dirty && coll.activeId !== id) {
    switchToTab(id);
  }
  if (t.meta.dirty) {
    const choice = await askSave(fileName(t.meta));
    if (choice === "cancel") return;
    if (choice === "save") {
      // Temporarily make this the active tab so doSave/activeTab() target it.
      // doSave reads activeTab(), so we must activate before saving.
      if (coll.activeId !== id) switchToTab(id);
      await doSave();
      if (t.meta.dirty) return; // save was cancelled in Save As
    }
    // "discard" falls through
  }
  // Tear down the view and remove from runtime + coll.
  t.view.destroy();
  runtime = runtime.filter((x) => x.id !== id);
  coll = closeTab(coll, id);
  if (coll.tabs.length === 0) {
    // Never leave the editor empty.
    appendAndActivate(createTab("", newDoc()));
    return;
  }
  // Re-bind meta to whatever is now active.
  const newActive = activeTab();
  meta = newActive.meta;
  showOnly(newActive.view);
  setEncoding(meta.encoding);
  setEol(meta.eol);
  void refreshTitle();
  applyPreviewMode();
  newActive.view.focus();
  paintTabBar();
  scheduleSessionSave();
}

async function doNew(): Promise<void> {
  appendAndActivate(createTab("", newDoc()));
}

async function openPath(path: string): Promise<void> {
  const existing = findTabByPath(coll, path);
  if (existing) {
    switchToTab(existing.id);
    return;
  }
  try {
    const doc = await readFile(path);
    const tab = createTab(doc.text, {
      path,
      encoding: doc.encoding,
      eol: doc.eol as DocMeta["eol"],
      dirty: false,
    });
    appendAndActivate(tab);
  } catch (e) {
    showError(`Could not open file:\n${e}`);
  }
}

async function doOpen(): Promise<void> {
  const path = await openDialog({ multiple: false, filters: FILTERS });
  if (typeof path === "string") await openPath(path);
}

async function doSave(): Promise<void> {
  const t = activeTab();
  if (!t.meta.path) {
    await doSaveAs();
    return;
  }
  try {
    await saveFile(t.meta.path, getText(t.view), t.meta.encoding, t.meta.eol);
    t.meta.dirty = false;
    void refreshTitle();
    paintTabBar();
    scheduleSessionSave();
  } catch (e) {
    showError(`Could not save file:\n${e}`);
  }
}

async function doSaveAs(): Promise<void> {
  const t = activeTab();
  const path = await saveDialog({
    defaultPath: t.meta.path ?? `${fileName(t.meta)}.txt`,
    filters: FILTERS,
  });
  if (!path) return;
  try {
    await saveFile(path, getText(t.view), t.meta.encoding, t.meta.eol);
    t.meta.path = path;
    t.meta.dirty = false;
    void refreshTitle();
    applyPreviewMode();
    paintTabBar();
    scheduleSessionSave();
  } catch (e) {
    showError(`Could not save file:\n${e}`);
  }
}

let menuHandles: MenuHandles | undefined;
try {
  menuHandles = await setupMenu(
    {
      newFile: () => void doNew(),
      openFile: () => void doOpen(),
      saveFile: () => void doSave(),
      saveFileAs: () => void doSaveAs(),
      print: () => window.print(),
      exit: () => void appWindow.close(),
      find: () => openSearchPanel(activeTab().view),
      replace: () => openSearchPanel(activeTab().view),
      goToLine: () => gotoLine(activeTab().view),
      setWrap: (on) => {
        settings.wrap = on;
        for (const t of runtime) setWrap(t.view, on);
        saveSettings(settings);
      },
      zoomIn: () => setZoom(settings.zoom + 10),
      zoomOut: () => setZoom(settings.zoom - 10),
      zoomReset: () => setZoom(100),
      chooseFont: () => openFontDialog(),
      togglePreview: (on) => {
        setPreviewVisible(on);
        if (on) renderPreviewNow(getText(activeTab().view));
      },
      toggleTheme: (on) => {
        settings.theme = on ? "dark" : "light";
        saveSettings(settings);
        applyTheme();
      },
      closeTab: () => {
        const id = coll.activeId;
        if (id) void closeTabById(id);
      },
      nextTab: () => {
        const next = nextTab(coll);
        if (next.activeId && next.activeId !== coll.activeId) switchToTab(next.activeId);
      },
      prevTab: () => {
        const prev = prevTab(coll);
        if (prev.activeId && prev.activeId !== coll.activeId) switchToTab(prev.activeId);
      },
    },
    settings.wrap,
    settings.theme === "dark",
  );
} catch (e) {
  console.error("menu setup failed:", e);
}

document.getElementById("editor")!.addEventListener(
  "scroll",
  () => {
    if (isPreviewVisible()) syncPreviewScroll(activeScrollDom());
  },
  true, // capture: scrollers are nested inside #editor
);

void appWindow.onCloseRequested(async (event) => {
  event.preventDefault();
  // Hot exit: silently stash every dirty buffer to localStorage and close.
  // Edits are restored dirty on next launch (restoreSessionOrNew), so the user
  // can save or discard then. Disk is never written here — save_file runs only
  // on explicit Save/Save As. Per-tab close (closeTabById) still prompts.
  persistSessionNow();
  await appWindow.destroy();
});

initTabBar({
  onSwitch: (id) => switchToTab(id),
  onClose: (id) => void closeTabById(id),
  onNew: () => void doNew(),
});

// WebView2 (Windows) swallows a fixed set of "browser shortcuts" — Ctrl+N/O/S/Shift+S
// and Ctrl+W — before the Tauri menu accelerator can see them. The accelerator is
// unreachable from app code for these keys, but the keydown still fires on window,
// so we reroute them here to the same fns the menu uses. On Linux (WebKitGTK) the
// accelerator handles them and this is a no-op duplicate, neutralized by preventDefault.
window.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  const key = e.key.toLowerCase();
  if (key === "w") {
    e.preventDefault();
    const id = coll.activeId;
    if (id) void closeTabById(id);
  } else if (key === "tab") {
    e.preventDefault();
    const target = e.shiftKey ? prevTab(coll) : nextTab(coll);
    if (target.activeId && target.activeId !== coll.activeId) switchToTab(target.activeId);
  } else if (key === "n") {
    e.preventDefault();
    void doNew();
  } else if (key === "o") {
    e.preventDefault();
    void doOpen();
  } else if (key === "s") {
    e.preventDefault();
    void (e.shiftKey ? doSaveAs() : doSave());
  }
});

void (async () => {
  // Register the single-instance listener BEFORE the first await: a forwarded
  // file can arrive during the getStartupFile() IPC roundtrip or during
  // restoreSessionOrNew(), and openPath's dedup (findTabByPath) makes either
  // arrival safe. Fire-and-forget the registration Promise.
  void listenOpenFile((p) => void openPath(p));

  const startupFile = await getStartupFile();
  // Always restore the saved session (untitled notes + previously opened files),
  // then open the OS-provided startup file alongside it. openPath dedups by path,
  // so if the startup file is already in the session it just switches to it.
  // See docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md
  // (supersedes the old tabs-§8 "skip restore on file arg" rule).
  await restoreSessionOrNew();
  if (startupFile) {
    await openPath(startupFile);
  }
})();

async function restoreSessionOrNew(): Promise<void> {
  const session = loadSession();
  if (!session) {
    appendAndActivate(createTab("", newDoc()));
    return;
  }
  for (const entry of session.entries) {
    if (entry.path && entry.text !== undefined) {
      // Dirty named buffer: restore the user's unsaved edits (do NOT re-read disk).
      // Dedup like openPath: a forwarded single-instance file for the same path
      // may arrive during restore; switch to the existing tab instead of duping.
      // ponytail: stale-buffer ceiling -- if the file changed on disk since this
      // snapshot, the stale buffer wins. Upgrade to an mtime comparison if that bites.
      const existing = findTabByPath(coll, entry.path);
      if (existing) {
        switchToTab(existing.id);
      } else {
        const m: DocMeta = {
          path: entry.path,
          encoding: entry.encoding,
          eol: entry.eol,
          dirty: true,
        };
        appendAndActivate(createTab(entry.text, m));
      }
    } else if (entry.path) {
      // Clean named file: re-read from disk (picks up external edits). Dedup applies.
      await openPath(entry.path);
    } else {
      // Untitled dirty buffer: restore text from the session blob.
      const m: DocMeta = {
        path: null,
        encoding: entry.encoding,
        eol: entry.eol,
        dirty: true, // still unsaved
      };
      appendAndActivate(createTab(entry.text ?? "", m));
    }
  }
  // Activate the tab the user had active (clamped index).
  const targetId = coll.tabs[session.activeIndex]?.id;
  if (targetId && targetId !== coll.activeId) {
    switchToTab(targetId);
  }
  // Cancel the debounce from N switchToTab/appendAndActivate calls and persist now,
  // so the startup snapshot reflects what's actually on screen (not whatever the 250ms
  // timer would have captured if it fired later).
  persistSessionNow();
}
