import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { askSave, showError } from "./dialogs";
import { DocMeta, fileName, newDoc, windowTitle } from "./document";
import { createEditor, getText, setText, setWrap } from "./editor";
import { getStartupFile, readFile, saveFile } from "./fileio";
import { MenuHandles, setupMenu } from "./menu";
import { clampFontSize, clampZoom, loadSettings, saveSettings, Settings } from "./settings";
import { initStatusBar, setCursor, setEncoding, setEol, setZoomDisplay } from "./statusbar";
import {
  isPreviewVisible,
  renderPreviewNow,
  setPreviewVisible,
  syncPreviewScroll,
  updatePreview,
} from "./preview";
import {
  closeTab,
  findTabByPath,
  genId,
  newCollection,
  openTab,
  switchTab,
  TabCollection,
  TabState,
} from "./tabs";
import { initTabBar, renderTabs, TabView } from "./tabbar";

const FILTERS = [
  { name: "Text files", extensions: ["txt", "md", "markdown", "log", "ini", "cfg"] },
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

initStatusBar({
  onEncodingChange: (encLabel) => {
    meta.encoding = encLabel;
    meta.dirty = true;
    void refreshTitle();
  },
  onEolChange: (eol) => {
    meta.eol = eol;
    meta.dirty = true;
    void refreshTitle();
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

function applyPreviewMode(): void {
  const on = isMarkdown(meta);
  setPreviewVisible(on);
  if (on) renderPreviewNow(getText(activeTab().view));
  void menuHandles?.previewItem.setChecked(on);
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

// ponytail: stubbed here, real debounce added in Task 7. For now, no-op.
function scheduleSessionSave(): void {
  /* filled in Task 7 */
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

/** Returns true when it is safe to discard the current buffer. */
async function confirmDiscard(): Promise<boolean> {
  if (!meta.dirty) return true;
  const choice = await askSave(fileName(meta));
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  await doSave();
  return !meta.dirty; // save may have been cancelled in the Save As dialog
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
    },
    settings.wrap,
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
  if (!meta.dirty) return; // allow close
  event.preventDefault();
  if (await confirmDiscard()) {
    await appWindow.destroy();
  }
});

initTabBar({
  onSwitch: (id) => switchToTab(id),
  onClose: (id) => void closeTabById(id),
  onNew: () => void doNew(),
});

// Bootstrap: one fresh untitled tab. Task 7 replaces this with startup-File-then-session logic.
appendAndActivate(createTab("", newDoc()));

void getStartupFile().then((p) => {
  if (p) void openPath(p);
});
