# Klad SP-1: Editor Essentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find/replace, go-to-line, word wrap, zoom, font setting, status bar, real encoding support (UTF-8/UTF-8 BOM/UTF-16 LE/BE/legacy), EOL convert, settings persistence, print.

**Architecture:** `@codemirror/search` provides the find/replace/go-to-line UI. Rust gains encoding detection (BOM sniff → UTF-8 validation → chardetng) behind the foundation's frozen `read_file`/`save_file` signatures. Status bar and font dialog are plain DOM. Settings live in `localStorage`.

**Tech Stack:** Adds `@codemirror/search` (npm), `encoding_rs` + `chardetng` (cargo). Nothing else.

**Spec:** `docs/artifacts/specs/klad/2026-07-16-klad-sp1-editor-design.md`

## Global Constraints

- Branch: `feat/klad-sp1-editor`, created from the merged `feat/klad`. (Deviation from the manifest-template naming `feat/klad/sp-1-...`: git forbids a branch named `feat/klad/...` while `feat/klad` exists.)
- Do NOT change the signatures of `read_file` / `save_file` / `get_startup_file`, `DocMeta` fields, or `createEditor(parent, onDocChanged, onCursor)` — other sub-projects compile against them.
- Encoding labels shown in the dropdown, exact strings: `UTF-8`, `UTF-8 BOM`, `UTF-16 LE`, `UTF-16 BE`, `Windows-1252`. Detection may report other legacy names (e.g. `windows-1251`); the status bar then shows that name as an extra option. Saving an unknown label encodes via `encoding_rs::Encoding::for_label`, falling back to windows-1252.
- Editor text stays LF-normalized in memory (foundation rule).
- Tests: `npm test` (vitest, pure logic only), `cargo test` in `src-tauri/`. UI wiring → final manual checklist.
- Commit after every task.
- `menu.ts` and `styles.css` are also touched by SP-2 — expected merge-conflict files, keep your changes minimal and additive.
- Permission errors in devtools console → add the named permission to `src-tauri/capabilities/default.json`.

---

### Task 1: Real encoding support in Rust

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/fs_cmds.rs`

**Interfaces:**
- Consumes: foundation `fs_cmds.rs` (`decode`, `encode`, `FileDoc`, tests module).
- Produces: same command signatures; `decode` now detects UTF-8/BOM/UTF-16 LE/BE/legacy; `encode` writes all five label families.

- [ ] **Step 1: Add dependencies to `src-tauri/Cargo.toml`**

```toml
encoding_rs = "0.8"
chardetng = "0.1"
```
(append to `[dependencies]`)

- [ ] **Step 2: Write the failing tests**

Append inside `mod tests` in `src-tauri/src/fs_cmds.rs`:
```rust
    #[test]
    fn detects_utf16_le_bom() {
        let p = tmp("u16le.txt");
        let mut bytes = vec![0xFF, 0xFE];
        for u in "héllo".encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        std::fs::write(&p, &bytes).unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "héllo");
        assert_eq!(doc.encoding, "UTF-16 LE");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn detects_utf16_be_bom() {
        let p = tmp("u16be.txt");
        let mut bytes = vec![0xFE, 0xFF];
        for u in "hi".encode_utf16() {
            bytes.extend_from_slice(&u.to_be_bytes());
        }
        std::fs::write(&p, &bytes).unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "hi");
        assert_eq!(doc.encoding, "UTF-16 BE");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn detects_windows_1252() {
        let p = tmp("w1252.txt");
        // "café" in windows-1252: é = 0xE9 (invalid as UTF-8 here)
        std::fs::write(&p, [b'c', b'a', b'f', 0xE9]).unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "café");
        assert_eq!(doc.encoding, "windows-1252");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn utf16_le_roundtrip() {
        let p = tmp("u16_rt.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "één\nregel".into(),
            "UTF-16 LE".into(),
            "CRLF".into(),
        )
        .unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "één\nregel");
        assert_eq!(doc.encoding, "UTF-16 LE");
        assert_eq!(doc.eol, "CRLF");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn utf16_be_roundtrip() {
        let p = tmp("u16be_rt.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "abc".into(),
            "UTF-16 BE".into(),
            "LF".into(),
        )
        .unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "abc");
        assert_eq!(doc.encoding, "UTF-16 BE");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn saves_windows_1252_label() {
        let p = tmp("w1252_save.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "café".into(),
            "Windows-1252".into(),
            "LF".into(),
        )
        .unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), [b'c', b'a', b'f', 0xE9]);
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn unmappable_chars_become_entities_in_1252() {
        // encoding_rs replaces unmappable chars with numeric character references
        let p = tmp("w1252_lossy.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "漢".into(),
            "Windows-1252".into(),
            "LF".into(),
        )
        .unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"&#28450;");
        std::fs::remove_file(p).unwrap();
    }
```

Run: `cd src-tauri` then `cargo test`
Expected: FAIL — new tests fail (detection/encoding not implemented); foundation tests still pass.

- [ ] **Step 3: Replace `decode` and `encode` in `src-tauri/src/fs_cmds.rs`**

```rust
fn decode_utf16(bytes: &[u8], le: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks(2)
        .map(|c| {
            let pair = [c[0], *c.get(1).unwrap_or(&0)];
            if le {
                u16::from_le_bytes(pair)
            } else {
                u16::from_be_bytes(pair)
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

fn decode(bytes: &[u8]) -> (String, String) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (
            String::from_utf8_lossy(&bytes[3..]).into_owned(),
            "UTF-8 BOM".to_string(),
        );
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return (decode_utf16(&bytes[2..], true), "UTF-16 LE".to_string());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return (decode_utf16(&bytes[2..], false), "UTF-16 BE".to_string());
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return (s.to_string(), "UTF-8".to_string());
    }
    let mut det = chardetng::EncodingDetector::new();
    det.feed(bytes, true);
    let enc = det.guess(None, true);
    let (text, _, _) = enc.decode(bytes);
    (text.into_owned(), enc.name().to_string())
}

fn encode(text: &str, encoding: &str) -> Vec<u8> {
    match encoding {
        "UTF-8" => text.as_bytes().to_vec(),
        "UTF-8 BOM" => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            out
        }
        "UTF-16 LE" => {
            let mut out = vec![0xFF, 0xFE];
            for u in text.encode_utf16() {
                out.extend_from_slice(&u.to_le_bytes());
            }
            out
        }
        "UTF-16 BE" => {
            let mut out = vec![0xFE, 0xFF];
            for u in text.encode_utf16() {
                out.extend_from_slice(&u.to_be_bytes());
            }
            out
        }
        other => {
            let enc = encoding_rs::Encoding::for_label(other.as_bytes())
                .unwrap_or(encoding_rs::WINDOWS_1252);
            enc.encode(text).0.into_owned()
        }
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test` (in `src-tauri/`)
Expected: PASS (12 tests: 5 foundation + 7 new).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/fs_cmds.rs
git commit -m "feat: encoding detection and multi-encoding save"
```

---

### Task 2: Settings module

**Files:**
- Create: `src/settings.ts`
- Test: `src/__tests__/settings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Settings { wrap: boolean; zoom: number; fontFamily: string; fontSize: number }`, `DEFAULT_SETTINGS`, `parseSettings(raw: string | null): Settings`, `loadSettings(): Settings`, `saveSettings(s: Settings): void`, `clampZoom(z: number): number` (10–500).

- [ ] **Step 1: Write the failing tests**

`src/__tests__/settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { clampZoom, DEFAULT_SETTINGS, parseSettings } from "../settings";

describe("settings", () => {
  it("null/corrupt/partial input falls back to defaults", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"zoom":150}')).toEqual({ ...DEFAULT_SETTINGS, zoom: 150 });
  });

  it("ignores junk keys and wrong types", () => {
    expect(parseSettings('{"zoom":"big","evil":1}')).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps zoom to 10-500", () => {
    expect(clampZoom(5)).toBe(10);
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(9000)).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../settings`.

- [ ] **Step 3: Implement `src/settings.ts`**

```ts
export interface Settings {
  wrap: boolean;
  zoom: number;
  fontFamily: string;
  fontSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  wrap: true,
  zoom: 100,
  fontFamily: "Consolas",
  fontSize: 14,
};

const KEY = "klad-settings";

export function clampZoom(z: number): number {
  return Math.min(500, Math.max(10, z));
}

export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SETTINGS };
  if (typeof obj.wrap === "boolean") out.wrap = obj.wrap;
  if (typeof obj.zoom === "number") out.zoom = clampZoom(obj.zoom);
  if (typeof obj.fontFamily === "string") out.fontFamily = obj.fontFamily;
  if (typeof obj.fontSize === "number") out.fontSize = obj.fontSize;
  return out;
}

export function loadSettings(): Settings {
  return parseSettings(
    typeof localStorage === "undefined" ? null : localStorage.getItem(KEY),
  );
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/__tests__/settings.test.ts
git commit -m "feat: persisted settings model with zoom clamp"
```

---

### Task 3: Search, wrap, extended menu

**Files:**
- Modify: `package.json` (dependency), `src/editor.ts`, `src/menu.ts`, `src/main.ts`, `src/styles.css`

**Interfaces:**
- Consumes: `createEditor` (foundation), `MenuActions`/`setupMenu` (foundation), `Settings` (Task 2).
- Produces:
  - `editor.ts`: adds `setWrap(view: EditorView, on: boolean): void`; `createEditor` gains a 4th param `initialWrap: boolean`.
  - `menu.ts`: `MenuActions` gains `find(): void; replace(): void; goToLine(): void; setWrap(on: boolean): void; zoomIn(): void; zoomOut(): void; zoomReset(): void; chooseFont(): void; print(): void`. `setupMenu(actions, initialWrap: boolean)` now returns `Promise<MenuHandles>` with `interface MenuHandles { wrapItem: CheckMenuItem }`.

- [ ] **Step 1: Install search package**

Run: `npm install @codemirror/search@^6`
Expected: added to `package.json` dependencies.

- [ ] **Step 2: Extend `src/editor.ts`**

Full replacement:
```ts
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { gotoLine, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

const wrapCompartment = new Compartment();

export function createEditor(
  parent: HTMLElement,
  onDocChanged: () => void,
  onCursor: (line: number, col: number) => void,
  initialWrap: boolean = true,
): EditorView {
  return new EditorView({
    state: EditorState.create({
      extensions: [
        history(),
        search({ top: true }),
        // custom bindings first so they win over searchKeymap defaults:
        // Ctrl+G = go to line (Notepad convention), Ctrl+H = replace
        keymap.of([
          { key: "Mod-g", run: gotoLine },
          { key: "Mod-h", run: openSearchPanel },
        ]),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        wrapCompartment.of(initialWrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onDocChanged();
          if (u.selectionSet || u.docChanged) {
            const pos = u.state.selection.main.head;
            const line = u.state.doc.lineAt(pos);
            onCursor(line.number, pos - line.from + 1);
          }
        }),
      ],
    }),
    parent,
  });
}

export function setWrap(view: EditorView, on: boolean): void {
  view.dispatch({
    effects: wrapCompartment.reconfigure(on ? EditorView.lineWrapping : []),
  });
}

export function getText(view: EditorView): string {
  return view.state.doc.toString();
}

export function setText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}
```

- [ ] **Step 3: Extend `src/menu.ts`**

Full replacement:
```ts
import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";

export interface MenuActions {
  newFile(): void;
  openFile(): void;
  saveFile(): void;
  saveFileAs(): void;
  print(): void;
  exit(): void;
  find(): void;
  replace(): void;
  goToLine(): void;
  setWrap(on: boolean): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  chooseFont(): void;
}

export interface MenuHandles {
  wrapItem: CheckMenuItem;
}

export async function setupMenu(
  actions: MenuActions,
  initialWrap: boolean,
): Promise<MenuHandles> {
  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      await MenuItem.new({ id: "new", text: "New", accelerator: "CmdOrCtrl+N", action: actions.newFile }),
      await MenuItem.new({ id: "open", text: "Open…", accelerator: "CmdOrCtrl+O", action: actions.openFile }),
      await MenuItem.new({ id: "save", text: "Save", accelerator: "CmdOrCtrl+S", action: actions.saveFile }),
      await MenuItem.new({ id: "saveAs", text: "Save As…", accelerator: "CmdOrCtrl+Shift+S", action: actions.saveFileAs }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "print", text: "Print…", accelerator: "CmdOrCtrl+P", action: actions.print }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "exit", text: "Exit", action: actions.exit }),
    ],
  });

  const editMenu = await Submenu.new({
    text: "Edit",
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "find", text: "Find…", accelerator: "CmdOrCtrl+F", action: actions.find }),
      await MenuItem.new({ id: "replace", text: "Replace…", accelerator: "CmdOrCtrl+H", action: actions.replace }),
      await MenuItem.new({ id: "goto", text: "Go to Line…", accelerator: "CmdOrCtrl+G", action: actions.goToLine }),
    ],
  });

  let wrapItem: CheckMenuItem | undefined;
  wrapItem = await CheckMenuItem.new({
    id: "wrap",
    text: "Word Wrap",
    checked: initialWrap,
    action: async () => actions.setWrap(await wrapItem!.isChecked()),
  });

  // NOTE for integration: SP-2 also adds an item to this View submenu
  // (Markdown Preview). On merge, keep wrap/zoom first, preview after.
  const viewMenu = await Submenu.new({
    text: "View",
    items: [
      wrapItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "zoomIn", text: "Zoom In", accelerator: "CmdOrCtrl+=", action: actions.zoomIn }),
      await MenuItem.new({ id: "zoomOut", text: "Zoom Out", accelerator: "CmdOrCtrl+-", action: actions.zoomOut }),
      await MenuItem.new({ id: "zoomReset", text: "Restore Default Zoom", accelerator: "CmdOrCtrl+0", action: actions.zoomReset }),
    ],
  });

  const formatMenu = await Submenu.new({
    text: "Format",
    items: [
      await MenuItem.new({ id: "font", text: "Font…", action: actions.chooseFont }),
    ],
  });

  const menu = await Menu.new({ items: [fileMenu, editMenu, viewMenu, formatMenu] });
  await menu.setAsAppMenu();
  return { wrapItem };
}
```

(Keep the foundation's fallback note: if the menu bar disappears on Windows, use the window-menu variant and add the permission the console names.)

- [ ] **Step 4: Wire into `src/main.ts`**

Add imports:
```ts
import { openSearchPanel, gotoLine } from "@codemirror/search";
import { setWrap } from "./editor";
import { clampZoom, loadSettings, saveSettings, Settings } from "./settings";
```

Add settings state + CSS application near the top (before `createEditor`):
```ts
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
```

Pass `settings.wrap` as the 4th argument to `createEditor(...)`.

Replace the `setupMenu` call with:
```ts
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
```

`main.ts` is not a module with top-level await by default under Vite? It is (ES2022 target) — if `tsc` complains, wrap the setup in an `async function init()` called with `void init()`. Add a placeholder `function openFontDialog(): void {}` (implemented in Task 5).

Add Ctrl+wheel zoom (after editor creation):
```ts
view.scrollDOM.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(settings.zoom + (e.deltaY < 0 ? 10 : -10));
  },
  { passive: false },
);
```

Add to `src/styles.css` (search panel fit):
```css
.cm-panels {
  border-bottom: 1px solid #d0d0d0;
  background: #f5f5f5;
  font-size: 13px;
}
.cm-panel.cm-search input,
.cm-panel.cm-search button,
.cm-panel.cm-search label {
  font-size: 12px;
}
```
And make the editor honor the font family var — change the `#editor .cm-scroller` rule to:
```css
#editor .cm-scroller {
  font-family: var(--editor-font-family, Consolas), "Courier New", monospace;
  font-size: var(--editor-font-size, 14px);
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` then `npm test` — clean/green.
Run: `npm run tauri dev` and check: Ctrl+F opens search panel (top), Ctrl+H shows the panel with replace row, Ctrl+G prompts for a line, View → Word Wrap toggles wrapping on a long line and the checkmark follows, Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel zoom the editor, File → Print… opens the print dialog.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/editor.ts src/menu.ts src/main.ts src/styles.css
git commit -m "feat: find/replace/goto, word wrap, zoom, print, extended menu"
```

---

### Task 4: Status bar

**Files:**
- Create: `src/statusbar.ts`
- Modify: `src/main.ts`, `src/styles.css`

**Interfaces:**
- Consumes: `#statusbar` div (foundation), `DocMeta`.
- Produces: `initStatusBar(cb: { onEncodingChange(enc: string): void; onEolChange(eol: "LF" | "CRLF"): void }): void`, `setCursor(line: number, col: number): void`, `setEncoding(label: string): void`, `setEol(eol: string): void`, `setZoomDisplay(pct: number): void`.

- [ ] **Step 1: Implement `src/statusbar.ts`**

```ts
const ENCODINGS = ["UTF-8", "UTF-8 BOM", "UTF-16 LE", "UTF-16 BE", "Windows-1252"];

let pos: HTMLElement;
let enc: HTMLSelectElement;
let eolSel: HTMLSelectElement;
let zoom: HTMLElement;

export function initStatusBar(cb: {
  onEncodingChange(enc: string): void;
  onEolChange(eol: "LF" | "CRLF"): void;
}): void {
  const bar = document.getElementById("statusbar")!;
  bar.innerHTML = `
    <span id="sb-pos">Ln 1, Col 1</span>
    <span class="sb-spacer"></span>
    <select id="sb-encoding" title="Encoding (applied on save)">
      ${ENCODINGS.map((e) => `<option>${e}</option>`).join("")}
    </select>
    <select id="sb-eol" title="Line endings (applied on save)">
      <option value="CRLF">Windows (CRLF)</option>
      <option value="LF">Unix (LF)</option>
    </select>
    <span id="sb-zoom">100%</span>
  `;
  pos = document.getElementById("sb-pos")!;
  enc = document.getElementById("sb-encoding") as HTMLSelectElement;
  eolSel = document.getElementById("sb-eol") as HTMLSelectElement;
  zoom = document.getElementById("sb-zoom")!;
  enc.onchange = () => cb.onEncodingChange(enc.value);
  eolSel.onchange = () => cb.onEolChange(eolSel.value as "LF" | "CRLF");
}

export function setCursor(line: number, col: number): void {
  pos.textContent = `Ln ${line}, Col ${col}`;
}

export function setEncoding(label: string): void {
  if (![...enc.options].some((o) => o.value === label)) {
    const opt = document.createElement("option");
    opt.textContent = label;
    enc.appendChild(opt);
  }
  enc.value = label;
}

export function setEol(eol: string): void {
  eolSel.value = eol;
}

export function setZoomDisplay(pct: number): void {
  zoom.textContent = `${pct}%`;
}
```

Add to `src/styles.css`:
```css
.sb-spacer {
  flex: 1;
}
#statusbar select {
  border: none;
  background: transparent;
  font-size: 12px;
  color: #444;
}
```

- [ ] **Step 2: Wire into `src/main.ts`**

- Import: `import { initStatusBar, setCursor, setEncoding, setEol, setZoomDisplay } from "./statusbar";`
- Replace the empty `onCursor` callback passed to `createEditor` with `(line, col) => setCursor(line, col)`.
- After settings are applied, initialize:
```ts
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
```
- In `loadIntoEditor`, after `meta = newMeta;` add:
```ts
setEncoding(meta.encoding);
setEol(meta.eol);
```
- In `setZoom`, add `setZoomDisplay(settings.zoom);`. Call `setZoomDisplay(settings.zoom)`, `setEncoding(meta.encoding)`, `setEol(meta.eol)` once at boot after `initStatusBar`.

- [ ] **Step 3: Verify**

Run: `npm run tauri dev` and check: cursor moves update `Ln, Col`; opening a CRLF file shows `Windows (CRLF)`; switching encoding to `UTF-16 LE` marks the title dirty; saving and reopening the file shows `UTF-16 LE` again (bytes really changed); zoom % follows Ctrl+wheel.

Run: `npx tsc --noEmit` && `npm test` — clean/green.

- [ ] **Step 4: Commit**

```bash
git add src/statusbar.ts src/main.ts src/styles.css
git commit -m "feat: status bar with cursor position and encoding/EOL switchers"
```

---

### Task 5: Font dialog + settings on boot

**Files:**
- Modify: `index.html`, `src/main.ts`

**Interfaces:**
- Consumes: `Settings` (Task 2), `applyEditorStyle()` (Task 3).
- Produces: working Format → Font… dialog; all settings survive restart.

- [ ] **Step 1: Add the dialog to `index.html`** (before the closing `</body>`, next to the other dialogs)

```html
<dialog id="fontDialog">
  <h3>Font</h3>
  <p>
    <label>Family
      <select id="fontFamilySel">
        <option>Consolas</option>
        <option>Cascadia Code</option>
        <option>Courier New</option>
        <option>Segoe UI</option>
        <option>monospace</option>
      </select>
    </label>
  </p>
  <p>
    <label>Size
      <input id="fontSizeInput" type="number" min="8" max="72" step="1" />
    </label>
  </p>
  <div class="dlg-buttons">
    <button id="btnFontOk">OK</button>
    <button id="btnFontCancel">Cancel</button>
  </div>
</dialog>
```

- [ ] **Step 2: Implement `openFontDialog` in `src/main.ts`** (replace the Task 3 placeholder)

```ts
function openFontDialog(): void {
  const dlg = document.getElementById("fontDialog") as HTMLDialogElement;
  const family = document.getElementById("fontFamilySel") as HTMLSelectElement;
  const size = document.getElementById("fontSizeInput") as HTMLInputElement;
  family.value = settings.fontFamily;
  size.value = String(settings.fontSize);
  dlg.showModal();
  document.getElementById("btnFontOk")!.onclick = () => {
    settings.fontFamily = family.value;
    settings.fontSize = Math.min(72, Math.max(8, Number(size.value) || 14));
    applyEditorStyle();
    saveSettings(settings);
    dlg.close();
    view.focus();
  };
  document.getElementById("btnFontCancel")!.onclick = () => dlg.close();
}
```

- [ ] **Step 3: Verify**

Run: `npm run tauri dev` and check: Format → Font… → pick Cascadia Code 18 → editor font changes; close app, relaunch → font, zoom, and wrap state restored.

- [ ] **Step 4: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat: font dialog, settings persist across restarts"
```

---

### Task 6: SP-1 verification checklist

**Files:**
- Create: `docs/artifacts/verification/klad-sp1-checklist.md`

- [ ] **Step 1: Run and record**

Create the file with each line marked PASS/FAIL after actually doing it:
```markdown
# SP-1 verification — YYYY-MM-DD

- [ ] `npm test`, `cargo test` (src-tauri/), `npx tsc --noEmit` all green
- [ ] Ctrl+F find with match highlighting; F3 next
- [ ] Ctrl+H replace one and replace-all work
- [ ] Ctrl+G jumps to line
- [ ] Word wrap toggle wraps a 500-char line; checkmark tracks state
- [ ] Zoom via menu, Ctrl+=/-/0, Ctrl+wheel; status bar % follows; clamped at 10/500
- [ ] Font change applies and persists
- [ ] Open UTF-16 LE file (make one in PowerShell: `"héllo" | Out-File u16.txt -Encoding Unicode`) → status bar shows UTF-16 LE, text correct
- [ ] Switch encoding UTF-8 → UTF-16 LE, save, reopen → still UTF-16 LE
- [ ] Switch EOL CRLF → LF, save → file has LF only (check with git diff or hex viewer)
- [ ] File → Print… opens print dialog
- [ ] Settings survive app restart
```

- [ ] **Step 2: Fix failures, then commit**

```bash
git add docs/artifacts/verification/klad-sp1-checklist.md
git commit -m "test: sp-1 verification checklist results"
```

---

## Self-review notes (already applied)

- Spec coverage: encodings (T1), settings (T2), search/wrap/zoom/menu/print (T3), status bar (T4), font (T5), checklist (T6). Recents dropped per spec.
- Deviation from spec recorded: legacy detection reports `enc.name()` (e.g. `windows-1252`) instead of forcing everything to the literal `Windows-1252` — saving still accepts any label via `for_label`, so a windows-1251 file is not silently transcoded. Status bar handles unknown labels by adding an option.
- Type consistency: `MenuActions`/`MenuHandles`/`setupMenu(actions, initialWrap)` match between Task 3 and 4; `createEditor` 4th param defaulted so SP-2 (which doesn't pass it) still compiles.
