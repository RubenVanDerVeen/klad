# Klad Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tauri v2 app shell — window, menu, CodeMirror 6 editor, New/Open/Save/Save As with dirty tracking, close guard, CLI-arg file open.

**Architecture:** Vanilla TypeScript frontend (Vite), CodeMirror 6 editor, Tauri v2 Rust backend exposing `read_file`/`save_file`/`get_startup_file` commands. Menu built with the Tauri v2 JS Menu API (plain JS callbacks). One window = one document, like classic Notepad.

**Tech Stack:** Tauri 2, TypeScript 5 (strict), Vite 6, CodeMirror 6, vitest 3, `@tauri-apps/plugin-dialog` 2.

**Spec:** `docs/artifacts/specs/klad/2026-07-16-klad-foundation-design.md`

## Global Constraints

- Branch: work directly on `feat/klad` (create from `main` first: `git checkout -b feat/klad`).
- Node ≥ 18, Rust stable toolchain, `npm` as package manager.
- Product name `Klad`, identifier `dev.ruben.klad`, window title pattern `{*if dirty}{filename} - Klad`, untitled docs are named `Untitled`.
- Vanilla TS only — no React/Vue/etc. TypeScript `strict: true`.
- Editor text is ALWAYS LF-normalized in memory; `eol` (`"LF"` | `"CRLF"`) lives in doc metadata and is applied on save.
- Encoding labels are exact strings: foundation uses `"UTF-8"` and `"UTF-8 BOM"` (SP-1 adds more — do not rename).
- Tests: `npm test` (vitest, pure logic only — no DOM test env) and `cargo test` inside `src-tauri/`. UI wiring is verified by the manual checklist in Task 8.
- Commit after every task (messages given per task).
- If the devtools console shows a Tauri permission error (`... not allowed. Permissions associated with this command: <perm>`), add that permission string to `src-tauri/capabilities/default.json` and re-run — do not disable the capability system.
- First `npm run tauri dev` compiles the Rust workspace: several minutes is normal.

---

### Task 1: Scaffold — dev app boots

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/styles.css`, `src/main.ts`, `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: running Tauri shell; DOM ids `#content`, `#editor`, `#preview` (hidden), `#statusbar`; npm scripts `dev`, `build`, `tauri`, `test`.

- [ ] **Step 1: Write all scaffold files**

`.gitignore`:
```gitignore
node_modules/
dist/
src-tauri/target/
src-tauri/gen/
```

`package.json`:
```json
{
  "name": "klad",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@codemirror/commands": "^6.8.0",
    "@codemirror/state": "^6.5.0",
    "@codemirror/view": "^6.36.0",
    "@tauri-apps/api": "^2.5.0",
    "@tauri-apps/plugin-dialog": "^2.2.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.5.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "useDefineForClassFields": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Untitled - Klad</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <main id="content">
      <div id="editor"></div>
      <div id="preview" hidden></div>
    </main>
    <div id="statusbar"></div>

    <dialog id="savePrompt">
      <p id="savePromptMsg"></p>
      <div class="dlg-buttons">
        <button id="btnSave">Save</button>
        <button id="btnDiscard">Don't Save</button>
        <button id="btnCancel">Cancel</button>
      </div>
    </dialog>

    <dialog id="errorBox">
      <p id="errorMsg"></p>
      <div class="dlg-buttons"><button id="btnErrOk">OK</button></div>
    </dialog>

    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/styles.css`:
```css
html,
body {
  height: 100%;
  margin: 0;
  font-family: "Segoe UI", system-ui, sans-serif;
  overflow: hidden;
}
body {
  display: flex;
  flex-direction: column;
}
#content {
  flex: 1;
  display: flex;
  min-height: 0;
}
#editor {
  flex: 1;
  min-width: 0;
}
#editor .cm-editor {
  height: 100%;
}
#editor .cm-editor.cm-focused {
  outline: none;
}
#editor .cm-scroller {
  font-family: Consolas, "Courier New", monospace;
  font-size: var(--editor-font-size, 14px);
}
#preview {
  flex: 1;
  min-width: 0;
  overflow: auto;
  border-left: 1px solid #d0d0d0;
  padding: 0 16px;
}
#statusbar {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 3px 12px;
  border-top: 1px solid #d0d0d0;
  font-size: 12px;
  color: #444;
  min-height: 18px;
}
dialog {
  border: 1px solid #bbb;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  font-size: 14px;
  min-width: 320px;
}
.dlg-buttons {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}
.dlg-buttons button {
  padding: 4px 14px;
}
```

`src/main.ts` (placeholder for this task only — replaced in Task 4):
```ts
document.getElementById("editor")!.textContent = "klad scaffold ok";
```

`src-tauri/Cargo.toml`:
```toml
[package]
name = "klad"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
strip = true
lto = true
```

`src-tauri/build.rs`:
```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Klad",
  "version": "0.1.0",
  "identifier": "dev.ruben.klad",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Untitled - Klad",
        "width": 1000,
        "height": 700
      }
    ],
    "security": { "csp": null }
  },
  "bundle": { "active": false }
}
```

`src-tauri/capabilities/default.json`:
```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "core:window:allow-close",
    "core:window:allow-destroy",
    "core:window:allow-set-title"
  ]
}
```

`src-tauri/src/main.rs` (minimal for this task — commands come in Task 3):
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Klad");
}
```

- [ ] **Step 2: Install and boot**

Run: `npm install`
Expected: completes without errors (warnings are fine).

Run: `npm run tauri dev`
Expected: Rust compiles (minutes on first run), then a window titled `Untitled - Klad` opens showing the text `klad scaffold ok` with an empty status bar strip at the bottom. Close the window; the command exits.

Run: `npm test`
Expected: exits 0 with "No test files found" (passWithNoTests).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: tauri v2 scaffold, app shell boots"
```

---

### Task 2: Document model (`document.ts`)

**Files:**
- Create: `src/document.ts`
- Test: `src/__tests__/document.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface DocMeta { path: string | null; encoding: string; eol: "LF" | "CRLF"; dirty: boolean }`, `newDoc(): DocMeta`, `defaultEol(ua?: string): "LF" | "CRLF"`, `fileName(meta: DocMeta): string`, `windowTitle(meta: DocMeta): string`. SP-1's status bar and SP-2's extension checks read `DocMeta` — do not rename fields.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/document.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { defaultEol, fileName, newDoc, windowTitle } from "../document";

describe("document model", () => {
  it("new doc is untitled, clean, UTF-8", () => {
    const d = newDoc();
    expect(d.path).toBeNull();
    expect(d.dirty).toBe(false);
    expect(d.encoding).toBe("UTF-8");
  });

  it("defaultEol is CRLF on Windows, LF elsewhere", () => {
    expect(defaultEol("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("CRLF");
    expect(defaultEol("Mozilla/5.0 (X11; Linux x86_64)")).toBe("LF");
  });

  it("fileName handles windows and unix paths, and untitled", () => {
    expect(fileName({ ...newDoc(), path: "C:\\notes\\todo.txt" })).toBe("todo.txt");
    expect(fileName({ ...newDoc(), path: "/home/ruben/todo.md" })).toBe("todo.md");
    expect(fileName(newDoc())).toBe("Untitled");
  });

  it("windowTitle marks dirty docs with *", () => {
    const d = { ...newDoc(), path: "C:\\a\\b.txt" };
    expect(windowTitle(d)).toBe("b.txt - Klad");
    expect(windowTitle({ ...d, dirty: true })).toBe("*b.txt - Klad");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../document`.

- [ ] **Step 3: Implement**

`src/document.ts`:
```ts
export interface DocMeta {
  path: string | null;
  encoding: string;
  eol: "LF" | "CRLF";
  dirty: boolean;
}

export function defaultEol(
  ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
): "LF" | "CRLF" {
  return ua.includes("Windows") ? "CRLF" : "LF";
}

export function newDoc(): DocMeta {
  return { path: null, encoding: "UTF-8", eol: defaultEol(), dirty: false };
}

export function fileName(meta: DocMeta): string {
  if (!meta.path) return "Untitled";
  return meta.path.split(/[\\/]/).pop() || "Untitled";
}

export function windowTitle(meta: DocMeta): string {
  return `${meta.dirty ? "*" : ""}${fileName(meta)} - Klad`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/document.ts src/__tests__/document.test.ts
git commit -m "feat: document metadata model"
```

---

### Task 3: Rust file commands (`fs_cmds.rs`)

**Files:**
- Create: `src-tauri/src/fs_cmds.rs`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: nothing.
- Produces (frozen — SP-1 changes internals only, never these signatures):
  - `read_file(path: String) -> Result<FileDoc, String>` where `FileDoc { text: String, encoding: String, eol: String }`; `text` LF-normalized, BOM stripped.
  - `save_file(path: String, text: String, encoding: String, eol: String) -> Result<(), String>`.
  - `get_startup_file() -> Option<String>`.

- [ ] **Step 1: Write module with failing tests**

`src-tauri/src/fs_cmds.rs`:
```rust
use serde::Serialize;

#[derive(Serialize)]
pub struct FileDoc {
    pub text: String,
    pub encoding: String,
    pub eol: String,
}

pub fn detect_eol(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "CRLF"
    } else {
        "LF"
    }
}

fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Foundation decodes UTF-8 (lossy) only; SP-1 replaces this with real detection.
fn decode(bytes: &[u8]) -> (String, String) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (
            String::from_utf8_lossy(&bytes[3..]).into_owned(),
            "UTF-8 BOM".to_string(),
        );
    }
    (String::from_utf8_lossy(bytes).into_owned(), "UTF-8".to_string())
}

fn encode(text: &str, encoding: &str) -> Vec<u8> {
    match encoding {
        "UTF-8 BOM" => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            out
        }
        _ => text.as_bytes().to_vec(),
    }
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileDoc, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let (raw_text, encoding) = decode(&bytes);
    let eol = detect_eol(&raw_text).to_string();
    Ok(FileDoc {
        text: normalize(&raw_text),
        encoding,
        eol,
    })
}

#[tauri::command]
pub fn save_file(path: String, text: String, encoding: String, eol: String) -> Result<(), String> {
    let out_text = if eol == "CRLF" {
        text.replace('\n', "\r\n")
    } else {
        text
    };
    std::fs::write(&path, encode(&out_text, &encoding)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_startup_file() -> Option<String> {
    std::env::args()
        .nth(1)
        .filter(|p| std::path::Path::new(p).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("klad_test_{}_{}", std::process::id(), name))
    }

    #[test]
    fn detects_eol() {
        assert_eq!(detect_eol("a\r\nb"), "CRLF");
        assert_eq!(detect_eol("a\nb"), "LF");
        assert_eq!(detect_eol("no newline"), "LF");
    }

    #[test]
    fn read_normalizes_crlf_and_reports_it() {
        let p = tmp("crlf.txt");
        std::fs::write(&p, b"one\r\ntwo\r\n").unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "one\ntwo\n");
        assert_eq!(doc.eol, "CRLF");
        assert_eq!(doc.encoding, "UTF-8");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn save_applies_crlf() {
        let p = tmp("save_crlf.txt");
        save_file(
            p.to_string_lossy().into_owned(),
            "one\ntwo".into(),
            "UTF-8".into(),
            "CRLF".into(),
        )
        .unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"one\r\ntwo");
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn utf8_bom_roundtrip() {
        let p = tmp("bom.txt");
        std::fs::write(&p, [0xEF, 0xBB, 0xBF, b'h', b'i']).unwrap();
        let doc = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(doc.text, "hi");
        assert_eq!(doc.encoding, "UTF-8 BOM");
        save_file(
            p.to_string_lossy().into_owned(),
            doc.text,
            doc.encoding,
            doc.eol,
        )
        .unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), [0xEF, 0xBB, 0xBF, b'h', b'i']);
        std::fs::remove_file(p).unwrap();
    }

    #[test]
    fn read_missing_file_errors() {
        assert!(read_file(tmp("nope.txt").to_string_lossy().into_owned()).is_err());
    }
}
```

Update `src-tauri/src/main.rs` to register the module and commands:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fs_cmds;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs_cmds::read_file,
            fs_cmds::save_file,
            fs_cmds::get_startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Klad");
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri` then `cargo test`
Expected: PASS (5 tests). (If you wrote the tests first without the impl, verify the FAIL first; the module above is small enough that file-at-once is acceptable — the tests still gate the commit.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/fs_cmds.rs src-tauri/src/main.rs
git commit -m "feat: read/save/startup-file commands with EOL + BOM handling"
```

---

### Task 4: Editor core (`editor.ts`) wired into the window

**Files:**
- Create: `src/editor.ts`
- Modify: `src/main.ts` (replace placeholder)

**Interfaces:**
- Consumes: DOM `#editor` from Task 1.
- Produces (SP-1/SP-2 rely on these exact signatures):
  - `createEditor(parent: HTMLElement, onDocChanged: () => void, onCursor: (line: number, col: number) => void): EditorView`
  - `getText(view: EditorView): string`
  - `setText(view: EditorView, text: string): void` (replaces whole doc, resets history is NOT required)

- [ ] **Step 1: Implement editor module**

`src/editor.ts`:
```ts
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

export function createEditor(
  parent: HTMLElement,
  onDocChanged: () => void,
  onCursor: (line: number, col: number) => void,
): EditorView {
  return new EditorView({
    state: EditorState.create({
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
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

export function getText(view: EditorView): string {
  return view.state.doc.toString();
}

export function setText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}
```

Replace `src/main.ts`:
```ts
import { createEditor } from "./editor";

const view = createEditor(
  document.getElementById("editor")!,
  () => {},
  () => {},
);
view.focus();
```

- [ ] **Step 2: Verify in dev app**

Run: `npm run tauri dev`
Expected: window opens with a focused, empty editor. Typing works; Ctrl+Z undoes; Ctrl+A selects all. Close the app.

Run: `npm test`
Expected: PASS (document tests still green).

- [ ] **Step 3: Commit**

```bash
git add src/editor.ts src/main.ts
git commit -m "feat: codemirror 6 editor core"
```

---

### Task 5: Frontend I/O wrappers + in-app dialogs

**Files:**
- Create: `src/fileio.ts`, `src/dialogs.ts`

**Interfaces:**
- Consumes: Rust commands from Task 3; `<dialog>` elements from Task 1.
- Produces:
  - `fileio.ts`: `interface FileDoc { text: string; encoding: string; eol: string }`, `readFile(path: string): Promise<FileDoc>`, `saveFile(path: string, text: string, encoding: string, eol: string): Promise<void>`, `getStartupFile(): Promise<string | null>`
  - `dialogs.ts`: `askSave(name: string): Promise<"save" | "discard" | "cancel">`, `showError(message: string): void`

- [ ] **Step 1: Implement both modules**

`src/fileio.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";

export interface FileDoc {
  text: string;
  encoding: string;
  eol: string;
}

export function readFile(path: string): Promise<FileDoc> {
  return invoke<FileDoc>("read_file", { path });
}

export function saveFile(
  path: string,
  text: string,
  encoding: string,
  eol: string,
): Promise<void> {
  return invoke<void>("save_file", { path, text, encoding, eol });
}

export function getStartupFile(): Promise<string | null> {
  return invoke<string | null>("get_startup_file");
}
```

`src/dialogs.ts`:
```ts
const savePrompt = document.getElementById("savePrompt") as HTMLDialogElement;
const savePromptMsg = document.getElementById("savePromptMsg")!;
const errorBox = document.getElementById("errorBox") as HTMLDialogElement;
const errorMsg = document.getElementById("errorMsg")!;

export function askSave(name: string): Promise<"save" | "discard" | "cancel"> {
  savePromptMsg.textContent = `Do you want to save changes to ${name}?`;
  savePrompt.showModal();
  return new Promise((resolve) => {
    const done = (result: "save" | "discard" | "cancel") => {
      savePrompt.close();
      resolve(result);
    };
    document.getElementById("btnSave")!.onclick = () => done("save");
    document.getElementById("btnDiscard")!.onclick = () => done("discard");
    document.getElementById("btnCancel")!.onclick = () => done("cancel");
    savePrompt.oncancel = (e) => {
      e.preventDefault();
      done("cancel");
    };
  });
}

export function showError(message: string): void {
  errorMsg.textContent = message;
  errorBox.showModal();
  document.getElementById("btnErrOk")!.onclick = () => errorBox.close();
}
```

DOM glue is covered by the Task 8 manual checklist, not unit tests (deliberate — no DOM test environment in this project).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/fileio.ts src/dialogs.ts
git commit -m "feat: invoke wrappers and in-app save/error dialogs"
```

---

### Task 6: Menu + file flows (New / Open / Save / Save As / Exit)

**Files:**
- Create: `src/menu.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Tasks 2-5 modules; `@tauri-apps/plugin-dialog` `open`/`save`; `@tauri-apps/api/window` `getCurrentWindow`; `@tauri-apps/api/menu`.
- Produces: `interface MenuActions { newFile(): void; openFile(): void; saveFile(): void; saveFileAs(): void; exit(): void }`, `setupMenu(actions: MenuActions): Promise<void>`. SP-1/SP-2 EXTEND `MenuActions` and add submenus inside `setupMenu` — keep the File/Edit submenu construction in the order written here.

- [ ] **Step 1: Implement menu module**

`src/menu.ts`:
```ts
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

export interface MenuActions {
  newFile(): void;
  openFile(): void;
  saveFile(): void;
  saveFileAs(): void;
  exit(): void;
}

export async function setupMenu(actions: MenuActions): Promise<void> {
  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      await MenuItem.new({ id: "new", text: "New", accelerator: "CmdOrCtrl+N", action: actions.newFile }),
      await MenuItem.new({ id: "open", text: "Open…", accelerator: "CmdOrCtrl+O", action: actions.openFile }),
      await MenuItem.new({ id: "save", text: "Save", accelerator: "CmdOrCtrl+S", action: actions.saveFile }),
      await MenuItem.new({ id: "saveAs", text: "Save As…", accelerator: "CmdOrCtrl+Shift+S", action: actions.saveFileAs }),
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
    ],
  });

  const menu = await Menu.new({ items: [fileMenu, editMenu] });
  await menu.setAsAppMenu();
}
```

Implementation note: if the menu bar does not appear on Windows, replace `menu.setAsAppMenu()` with setting it on the current window (`import { getCurrentWindow } from "@tauri-apps/api/window"` → `getCurrentWindow().setMenu?.(menu)` per the installed `@tauri-apps/api` version) and add whatever `core:menu:*` / `core:window:*` permission the console names to `capabilities/default.json`. Keep the `MenuActions` interface unchanged.

- [ ] **Step 2: Wire the flows in `src/main.ts`** (full replacement)

```ts
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { askSave, showError } from "./dialogs";
import { DocMeta, fileName, newDoc, windowTitle } from "./document";
import { createEditor, getText, setText } from "./editor";
import { getStartupFile, readFile, saveFile } from "./fileio";
import { setupMenu } from "./menu";

const FILTERS = [
  { name: "Text files", extensions: ["txt", "md", "markdown", "log", "ini", "cfg"] },
  { name: "All files", extensions: ["*"] },
];

let meta: DocMeta = newDoc();
const appWindow = getCurrentWindow();

const view = createEditor(
  document.getElementById("editor")!,
  () => {
    if (!meta.dirty) {
      meta.dirty = true;
      void refreshTitle();
    }
  },
  () => {}, // SP-1 wires the status bar here
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

void setupMenu({
  newFile: () => void doNew(),
  openFile: () => void doOpen(),
  saveFile: () => void doSave(),
  saveFileAs: () => void doSaveAs(),
  exit: () => void appWindow.close(),
});

void getStartupFile().then((p) => {
  if (p) return openPath(p);
});

view.focus();
```

- [ ] **Step 3: Verify in dev app**

Run: `npm run tauri dev` and check:
- Menu bar shows File and Edit.
- Type text → title becomes `*Untitled - Klad`.
- Ctrl+S → save dialog → save as `scratch.txt` → title `scratch.txt - Klad` (no `*`).
- Ctrl+O → reopen the file → contents intact.
- File → New with unsaved changes → Save/Don't Save/Cancel prompt appears; Cancel keeps the buffer.
- Edit → Cut/Copy/Paste work on a selection.

Expected: all pass. (Close guard on the X button is Task 7 — not yet expected to prompt.)

- [ ] **Step 4: Run checks**

Run: `npx tsc --noEmit` then `npm test`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/menu.ts src/main.ts
git commit -m "feat: menu bar and new/open/save/save-as/exit flows"
```

---

### Task 7: Close guard + startup polish

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `confirmDiscard()` and `appWindow` from Task 6.
- Produces: window close (X button and File → Exit) always routes through the unsaved-changes prompt.

- [ ] **Step 1: Add the close guard to `src/main.ts`**

Insert after the `setupMenu` call:
```ts
void appWindow.onCloseRequested(async (event) => {
  if (!meta.dirty) return; // allow close
  event.preventDefault();
  if (await confirmDiscard()) {
    await appWindow.destroy();
  }
});
```

- [ ] **Step 2: Verify in dev app**

Run: `npm run tauri dev` and check:
- Clean buffer + X button → window closes.
- Dirty buffer + X button → prompt; Cancel keeps app open; Don't Save closes; Save with completed save closes... verify Save path: make change, X, Save → file written and window closes.
- Dirty buffer + File → Exit → same prompt.
- `npm run tauri dev -- -- -- somefile.txt` is awkward in dev; startup-file behavior is fully verified from the built exe in SP-3. Skip here.

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: unsaved-changes guard on window close"
```

---

### Task 8: Foundation verification checklist

**Files:**
- Create: `docs/artifacts/verification/klad-foundation-checklist.md`

**Interfaces:**
- Consumes: everything above.
- Produces: recorded pass/fail evidence for integration.

- [ ] **Step 1: Run the full checklist against `npm run tauri dev` and record results**

Create `docs/artifacts/verification/klad-foundation-checklist.md` with each line marked PASS/FAIL after actually doing it:
```markdown
# Foundation verification — YYYY-MM-DD

- [ ] `npm test` green
- [ ] `cargo test` green (run in src-tauri/)
- [ ] `npx tsc --noEmit` clean
- [ ] App boots to empty Untitled editor, focused
- [ ] Typing marks title dirty (*)
- [ ] New/Open/Save/Save As/Exit all reachable via menu AND shortcut
- [ ] Save→reopen round-trip preserves content exactly (create a file with CRLF in another editor, open, save, confirm CRLF preserved via `git diff --no-index` or a hex viewer)
- [ ] UTF-8 BOM file keeps its BOM after save
- [ ] Unsaved-changes prompt on: New, Open, Exit, window X — all three buttons behave
- [ ] Open failure (delete a file, then open it via a stale path if reproducible — otherwise open a locked file) shows the error dialog, app stays alive
```

- [ ] **Step 2: Fix anything that fails, then commit**

```bash
git add docs/artifacts/verification/klad-foundation-checklist.md
git commit -m "test: foundation verification checklist results"
```

---

## Self-review notes (already applied)

- Spec coverage: shell/layout (T1), doc model (T2), Rust I/O + CLI arg (T3), editor core (T4), dialogs (T5), menu + flows (T6), close guard (T7), verification (T8). Spec's "UTF-8 only" widened to include BOM preservation — 3 lines that prevent silently rewriting users' files; noted in spec terms as foundation behavior.
- Type consistency: `DocMeta`, `FileDoc`, `MenuActions`, `createEditor` signatures match across tasks and are the frozen interfaces the SP plans reference.
- No placeholders: every step has full code or an exact command + expected output.
