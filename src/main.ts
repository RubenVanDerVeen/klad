import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { gotoLine, openSearchPanel } from "@codemirror/search";
import { askSave, showError } from "./dialogs";
import { DocMeta, fileName, newDoc, windowTitle } from "./document";
import { createEditor, getText, setText, setWrap } from "./editor";
import { getStartupFile, readFile, saveFile } from "./fileio";
import { setupMenu } from "./menu";
import { clampZoom, loadSettings, saveSettings, Settings } from "./settings";

const FILTERS = [
  { name: "Text files", extensions: ["txt", "md", "markdown", "log", "ini", "cfg"] },
  { name: "All files", extensions: ["*"] },
];

let meta: DocMeta = newDoc();
const appWindow = getCurrentWindow();

const settings: Settings = loadSettings();

function applyEditorStyle(): void {
  const root = document.documentElement.style;
  root.setProperty("--editor-font-family", settings.fontFamily);
  root.setProperty("--editor-font-size", `${(settings.fontSize * settings.zoom) / 100}px`);
}
applyEditorStyle();

function setZoom(z: number): void {
  settings.zoom = clampZoom(z);
  applyEditorStyle();
  saveSettings(settings);
}

function openFontDialog(): void {
  // Implemented in Task 5
}

const view = createEditor(
  document.getElementById("editor")!,
  () => {
    if (!meta.dirty) {
      meta.dirty = true;
      void refreshTitle();
    }
  },
  () => {}, // SP-1 wires the status bar here
  settings.wrap,
);

view.scrollDOM.addEventListener(
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

function loadIntoEditor(text: string, newMeta: DocMeta): void {
  setText(view, text);
  meta = newMeta;
  void refreshTitle();
  view.focus();
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
  if (!(await confirmDiscard())) return;
  loadIntoEditor("", newDoc());
}

async function openPath(path: string): Promise<void> {
  try {
    const doc = await readFile(path);
    loadIntoEditor(doc.text, {
      path,
      encoding: doc.encoding,
      eol: doc.eol as DocMeta["eol"],
      dirty: false,
    });
  } catch (e) {
    showError(`Could not open file:\n${e}`);
  }
}

async function doOpen(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const path = await openDialog({ multiple: false, filters: FILTERS });
  if (typeof path === "string") await openPath(path);
}

async function doSave(): Promise<void> {
  if (!meta.path) {
    await doSaveAs();
    return;
  }
  try {
    await saveFile(meta.path, getText(view), meta.encoding, meta.eol);
    meta.dirty = false;
    void refreshTitle();
  } catch (e) {
    showError(`Could not save file:\n${e}`);
  }
}

async function doSaveAs(): Promise<void> {
  const path = await saveDialog({
    defaultPath: meta.path ?? `${fileName(meta)}.txt`,
    filters: FILTERS,
  });
  if (!path) return;
  try {
    await saveFile(path, getText(view), meta.encoding, meta.eol);
    meta.path = path;
    meta.dirty = false;
    void refreshTitle();
  } catch (e) {
    showError(`Could not save file:\n${e}`);
  }
}

const menuHandles = await setupMenu(
  {
    newFile: () => void doNew(),
    openFile: () => void doOpen(),
    saveFile: () => void doSave(),
    saveFileAs: () => void doSaveAs(),
    print: () => window.print(),
    exit: () => void appWindow.close(),
    find: () => openSearchPanel(view),
    replace: () => openSearchPanel(view),
    goToLine: () => gotoLine(view),
    setWrap: (on) => {
      settings.wrap = on;
      setWrap(view, on);
      saveSettings(settings);
    },
    zoomIn: () => setZoom(settings.zoom + 10),
    zoomOut: () => setZoom(settings.zoom - 10),
    zoomReset: () => setZoom(100),
    chooseFont: () => openFontDialog(),
  },
  settings.wrap,
);
void menuHandles;

void appWindow.onCloseRequested(async (event) => {
  if (!meta.dirty) return; // allow close
  event.preventDefault();
  if (await confirmDiscard()) {
    await appWindow.destroy();
  }
});

void getStartupFile().then((p) => {
  if (p) return openPath(p);
});

view.focus();
