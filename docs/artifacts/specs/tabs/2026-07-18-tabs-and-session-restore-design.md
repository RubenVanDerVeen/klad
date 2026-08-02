# Tabs and Session Restore — Design

- **Date:** 2026-07-18
- **Topic:** `tabs`
- **Status:** Spec (awaiting review)
- **Scope:** Frontend-only. No Rust changes, no new Tauri commands, no new capabilities, no new deps.
- **Author:** Planner session 2026-07-18

## 1. Problem

Klad today holds exactly one document. `let meta: DocMeta` (one metadata object) and a single CodeMirror `EditorView` are the app's two anchors; `loadIntoEditor` is the only document-swap choke point (`src/main.ts:24`, `:77`, `:115`). To open a second file you must discard the first. Classic-Notepad users moving to klad expect to keep several files open at once and to find them open again next time, the way Notepad++ and VS Code do.

Two capabilities are added together:

1. **Multiple tabs** — one tab per open file, VS Code-style (per-tab label, dirty dot, close button, `+` to add a tab).
2. **Session restore** — after closing klad, reopening it brings back the same files plus any unsaved untitled buffers.

## 2. Goals and non-goals

### Goals

- One tab per open file. New tab via `+`, File > New, or `Ctrl+N`.
- Switch tabs by click, `Ctrl+Tab` / `Ctrl+Shift+Tab`, or by re-opening an already-open file.
- Close a tab via per-tab `×`, `Ctrl+W`, middle-click, or File > Close. Dirty tabs prompt to save using the existing `savePrompt` dialog.
- Dirty dot per tab (mirrors the title-bar `*` already used for the single doc).
- On launch, restore: (a) the list of named files (paths), (b) any unsaved untitled buffers with their text, and (c) which tab was active. Empty untitled tabs are not restored.
- Persist session on every tab-affecting mutation and on close.

### Non-goals (YAGNI for v1)

- **Multi-window / OS windows.** In-app tabs only.
- **Single-instance mode.** A second OS-launched klad process is a separate instance with its own localStorage. See §11 known limitations.
- **Drag-reorder of tabs.** Open-order only.
- **Drag-drop files onto the window.** No drag-drop infrastructure exists today; adding it is independent scope.
- **Per-tab cursor position / scroll restore.** Named files reopen at top-of-file; untitled buffers restore text but not caret. (Each tab's own `EditorView` *does* keep caret/scroll/undo alive for the duration of a session — this exclusion is only about *cross-restart* restore.)
- **Tab pinning, splitting, or grouping.**
- **"Recently closed" / reopen-closed-tab.**
- **Reopen-of-saved-file should re-read from disk vs. keep buffer.** Out of scope; on restart we re-read named files from disk (so external edits are picked up), untitled buffers come from localStorage verbatim.
- **Multi-file CLI startup.** `get_startup_file` stays singular. OS double-click already launches one file per process; multi-arg CLI is only useful with single-instance mode, which is itself a non-goal.

## 3. User stories

- Open three files, edit two, close klad → on next launch, all three reopen and the two edited ones come back with their unsaved text.
- Have file A open. OS double-click file A again (or File > Open it) → klad switches to A's existing tab, does not open a duplicate.
- Have file A (clean) and file B (dirty) open. Press `Ctrl+W` in B → savePrompt appears. "Save" → B saves and closes, A becomes active. "Cancel" → B stays open. "Don't Save" → B closes, work lost, A becomes active.
- Have five tabs open. Press `Ctrl+Tab` repeatedly → cycles forward through tabs in bar order. `Ctrl+Shift+Tab` cycles backward.
- Click the `+` → a new untitled tab is created and becomes active.
- Click a tab's `×` when its buffer is clean → tab closes immediately, no prompt.

## 4. Architecture decision

**Approach A — one EditorView per tab.** Each tab owns a live CodeMirror `EditorView`; all are children of `#editor`, only the active one is visible (`hidden` attribute on the others). Chosen over shared-view-with-state-swap because:

- Undo history, cursor, scroll, and folds survive tab switches for free — no separate caching of `scrollDOM.scrollTop` (which `EditorState` does not carry).
- The current single-view code has a latent bug already: `setText` (a `changes` dispatch) doesn't reset undo history, so opening a second file can undo back into the first. Per-tab views make this moot.
- Cost is more DOM nodes and memory. At klad's scale (typically <20 tabs of plain text) this is irrelevant.
- Diff size is comparable to the shared-view approach, and correctness is higher.

Switching tabs is therefore **hide outgoing view → update `meta` and push to status bar / title / preview → show incoming view → focus it.** No state swap.

## 5. Data model

### Pure logic — `src/tabs.ts` (new)

Holds no `EditorView` (testable without CodeMirror, mirroring `document.ts` + `settings.ts` convention):

```ts
export interface TabState {
  id: string;            // unique within a session, not persisted as identity
  meta: DocMeta;         // path / encoding / eol / dirty (reused from document.ts)
  unsavedText?: string;  // present only when persisting a dirty untitled buffer
}

export interface TabCollection {
  tabs: TabState[];
  activeId: string | null;   // null only when tabs is empty
}

// Operations (all return new collections, like Redux-style reducers):
export function newCollection(): TabCollection;
export function openTab(coll: TabCollection, tab: TabState): TabCollection;     // appends, activates
export function closeTab(coll: TabCollection, id: string): TabCollection;      // removes; active -> neighbor
export function switchTab(coll: TabCollection, id: string): TabCollection;     // sets activeId
export function findTabByPath(coll: TabCollection, path: string): TabState | null;
export function nextTab(coll: TabCollection): TabCollection;                   // active -> next wrap
export function prevTab(coll: TabCollection): TabCollection;                   // active -> prev wrap
export function genId(): string;                                               // counter-based, e.g. "t1","t2"
```

**Close-tab active-selection rule:** after closing the active tab, the *next* sibling becomes active; if the closed tab was last, the *previous* sibling becomes active; if no siblings remain, the collection is empty (`activeId: null`) and the orchestrator immediately creates a fresh untitled tab so the editor is never empty.

### Persistence shape — `src/session.ts` (new)

```ts
export interface SessionEntry {
  path: string | null;       // null => untitled buffer
  encoding: string;
  eol: "LF" | "CRLF";
  text?: string;             // present only for untitled dirty buffers
}

export interface Session {
  entries: SessionEntry[];   // open-order
  activeIndex: number;       // 0-based; clamped on load
}
```

`activeIndex` (not `activeId`) is persisted because tab ids are not stable across restart. Index is unambiguous given the entry order.

Persistence API mirrors `settings.ts`:

```ts
const KEY = "klad-session";
export function parseSession(raw: string | null): Session | null;   // defensive; null if absent/corrupt
export function loadSession(): Session | null;
export function saveSession(s: Session): void;
export function clearSession(): void;                                // write empty/remove
```

Defensive parse rules: reject non-object, non-array `entries`, non-number `activeIndex`, wrong-typed fields, entries missing `encoding`/`eol`. Clamp `activeIndex` to `[0, entries.length - 1]`. Drop entries whose `path` is null AND `text` is missing (clean untitled tabs were never worth saving). On any structural problem with the top-level object, return `null` (treat as no session).

### Runtime — `src/main.ts` (modified)

```ts
interface RuntimeTab extends TabState {
  view: EditorView;   // owned, live, child of #editor
}

let coll: TabCollection;          // pure state, mirrors the source of truth
let runtime: RuntimeTab[];        // same order as coll.tabs; carries the views
function activeTab(): RuntimeTab; // runtime.find(t => t.id === coll.activeId)
```

The `DocMeta` in `coll.tabs[i].meta` and the `meta` singleton used by status-bar/title code is the **same reference** for the active tab — i.e. we keep `let meta: DocMeta` as an alias of `activeTab().meta`, reassigned on every switch. This minimizes the diff to existing push-driven code (status bar, preview, title all keep reading `meta`).

## 6. Module structure

### New files

| File | Purpose | LOC estimate |
|---|---|---|
| `src/tabs.ts` | Pure tab-collection reducers | ~60 |
| `src/session.ts` | localStorage load/save/parse for session | ~50 |
| `src/tabbar.ts` | Tab bar DOM build + render + event wiring | ~70 |
| `src/__tests__/tabs.test.ts` | Unit tests for `tabs.ts` reducers | ~70 |
| `src/__tests__/session.test.ts` | Unit tests for `session.ts` parse/round-trip | ~40 |

### Modified files

| File | Change |
|---|---|
| `index.html` | Add `<div id="tabbar"></div>` as first child of `<body>`, above `<main id="content">`. |
| `src/styles.css` | Add `#tabbar`, `.tab`, `.tab.active`, `.tab.dirty`, `.tab-close`, `#new-tab` rules. Match klad's **light** theme (the dark screenshot was VS Code, not klad). |
| `src/main.ts` | Replace single-`view` orchestration with `runtime: RuntimeTab[]` + `coll`. Replace `loadIntoEditor` with `switchToTab(id)`, `openPath` with dedup-or-create logic, `onCloseRequested` with dirty-tab walk, `doNew`/`doOpen`/`doSave`/`doSaveAs` to operate on active tab. Add session save hooks. Add keyboard listeners for `Ctrl+W` / `Ctrl+Tab` / `Ctrl+Shift+Tab`. |
| `src/menu.ts` | Add `closeTab`, `nextTab`, `prevTab` to `MenuActions`. Wire File > Close Tab (`Ctrl+W`). Wire a new "Tabs" submenu or place Next/Prev Tab items under View. (Detail in §9.) |
| `src/editor.ts` | No API change. Reused one-per-tab. (Optional: add a `destroyEditor(view)` thin wrapper around `view.destroy()` to centralize teardown — only if the call site reads unclear without it. YAGNI default: just call `view.destroy()` directly in `main.ts`.) |
| `src/document.ts` | No change. Reused as-is. |

### Untouched (called out because AGENTS.md catalogs them)

- `src-tauri/src/main.rs` `invoke_handler![]` — no new commands.
- `src-tauri/src/fs_cmds.rs` — unchanged.
- `src/fileio.ts` — unchanged (`readFile`, `saveFile`, `getStartupFile` all reused as-is).
- `src-tauri/tauri.conf.json` `bundle.fileAssociations` — unchanged.
- `src-tauri/capabilities/default.json` — unchanged.
- `package.json` / `src-tauri/Cargo.toml` — no new deps.

## 7. UI design

### Layout

`#tabbar` sits between the top of `<body>` and `<main id="content">`. `<body>` is already `display:flex; flex-direction:column`, so adding a strip is layout-cheap. `#content` keeps its existing `flex:1` row of editor + preview.

```
<body>
  <div id="tabbar"></div>      <!-- NEW -->
  <main id="content">
    <div id="editor"></div>    <!-- now hosts N views, only active visible -->
    <div id="preview" hidden></div>
  </main>
  <div id="statusbar"></div>
  ...
</body>
```

### Tab bar DOM (built dynamically by `src/tabbar.ts`)

```
<div id="tabbar">
  <div class="tab active" data-id="t1">
    <span class="tab-label">readme.md</span>
    <span class="tab-dot" ></span>      <!-- shown via [data-dirty="true"] on .tab -->
    <button class="tab-close" title="Close (Ctrl+W)">×</button>
  </div>
  <div class="tab" data-id="t2">…</div>
  …
  <button id="new-tab" title="New tab (Ctrl+N)">+</button>
</div>
```

### Tab bar API (`src/tabbar.ts`)

Mirrors `statusbar.ts` shape — push-driven from `main.ts`:

```ts
export interface TabBarHooks {
  onSwitch(id: string): void;
  onClose(id: string): void;
  onNew(): void;
}

export function initTabBar(hooks: TabBarHooks): void;

// Re-renders the bar from a snapshot. Called after every tab-affecting mutation.
export interface TabView {
  id: string;
  label: string;
  dirty: boolean;
  active: boolean;
}
export function renderTabs(views: TabView[]): void;
```

Behavior:
- Click `.tab` (not the close button) → `onSwitch(id)`.
- Click `.tab-close` → `onClose(id)`.
- Click `#new-tab` → `onNew()`.
- Middle-click on `.tab` → `onClose(id)`.
- The dirty dot is shown/hidden via a `data-dirty="true"` attribute on `.tab`, which CSS keys off — no DOM add/remove churn.

### Styling (light theme, not the dark screenshot)

Grounded in existing klad tokens: `#d0d0d0` borders, `#444` text, white surfaces, `Segoe UI` font. Sketch (final values decided during implementation):

```css
#tabbar {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0 4px;
  border-bottom: 1px solid #d0d0d0;
  background: #f5f5f5;
  min-height: 28px;
  font-size: 12px;
  overflow-x: auto;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 12px;
  cursor: default;
  border-right: 1px solid #e0e0e0;
  white-space: nowrap;
}
.tab:hover { background: #eaeaea; }
.tab.active { background: #fff; border-top: 2px solid #0078d4; margin-top: -1px; }
.tab[data-dirty="true"] .tab-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #0078d4;
}
.tab-dot { display: none; }
.tab-close {
  border: none; background: transparent; cursor: pointer;
  color: #666; padding: 0 4px; font-size: 14px; line-height: 1;
}
.tab-close:hover { background: #d0d0d0; border-radius: 3px; }
#new-tab {
  border: none; background: transparent; cursor: pointer;
  font-size: 16px; padding: 0 8px; color: #444;
  align-self: center;
}
#new-tab:hover { background: #e0e0e0; border-radius: 3px; }
```

## 8. Behaviors

### Tab open

`openPath(path)`:
1. `findTabByPath(coll, path)` → if found, `switchTab(existing.id)` and return (no duplicate).
2. Else `readFile(path)`, create new `RuntimeTab` (new `EditorView`, `setText` of decoded content, `meta = { path, encoding, eol, dirty:false }`), append to `runtime` and `coll.tabs`, `switchTab(newId)`.
3. Update tab bar via `renderTabs`.
4. Persist session (debounced).

`doNew()`:
1. Create `RuntimeTab` with `newDoc()` (untitled, empty), append, switch.
2. No longer calls `confirmDiscard` first — a new tab doesn't disturb the existing one. (Old behavior of prompting before New was a single-doc constraint; with tabs it's not needed.)

### Tab close

`closeTabById(id)`:
1. If the tab is dirty, switch to it first (so the user sees what they're being asked about), then `confirmDiscard()` via existing `askSave` dialog.
   - Cancel → abort.
   - Don't Save → proceed to remove.
   - Save → `doSave()` first; if save is itself cancelled (Save As dialog dismissed), abort.
2. `view.destroy()` for the outgoing tab.
3. `coll = closeTab(coll, id)` (pure reducer picks new active — next sibling, then previous, then empty).
4. If `coll.tabs` is now empty, immediately create a fresh untitled tab (klad is never empty-editor).
5. `renderTabs`, focus active view, persist session.

### Tab switch

`switchToTab(id)`:
1. If `id === coll.activeId`, no-op.
2. Hide outgoing `view.dom` (`hidden` attribute).
3. `coll = switchTab(coll, id)`.
4. `meta = activeTab().meta` (re-bind the singleton).
5. `setEncoding(meta.encoding)`, `setEol(meta.eol)`.
6. `refreshTitle()`.
7. `applyPreviewMode()` (reads new `meta.path` to decide visibility, renders `getText(activeView)` if visible).
8. Show incoming `view.dom`, `view.focus()`.
9. Persist session (only the `activeIndex` changed — cheap write, still debounced).

### Dirty indicator and title

- The per-tab dirty dot reflects the tab's own `meta.dirty`.
- The window title keeps the existing `*` prefix for the active tab only.
- `onDocChanged` callback (created per view at `createEditor` time) must close over the **owning tab's** `meta`, not the active-tab singleton — otherwise typing in a background tab would set the active tab's dirty flag. Each view's `onDocChanged` does:
  ```ts
  owner.meta.dirty = true;
  if (owner.id === coll.activeId) {
    void refreshTitle();
    updatePreview(getText(owner.view));
    renderTabs(toTabViews());  // to flip this tab's dot on
  }
  ```
- Encoding/EOL changes from the status bar mutate the **active** tab's `meta` (existing behavior preserved; only named via the rebound `meta`).

### Save / Save As

`doSave()` and `doSaveAs()` operate on the active tab. They already read/write `meta.path`, `meta.dirty`, and `getText(view)` — these become `getText(activeTab().view)` and the rebound `meta`. On successful Save As (path changes), `applyPreviewMode()` must be re-run because the markdown-ness can change with the extension. After any save, `renderTabs()` is called to clear the dirty dot.

### Multi-instance (non-goal, but documented behavior)

**Superseded 2026-08-02** by `docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md`. The "skip session restore when launched with a CLI file argument" rule documented here was defensive against multi-instance last-writer-wins across divergent localStorage views. Two later changes made it obsolete: single-instance mode (`docs/artifacts/specs/single-instance/2026-07-18-single-instance-design.md`, exactly one long-lived instance, second launches forward their argv and exit) and hot-exit (`docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md`, close now silently stashes every dirty buffer). The current behavior is: a cold double-clicked-file launch restores the saved session **and then** opens the startup file alongside it, matching the already-running forward path. See the restore-on-launch spec for the full behavior matrix and rationale.

The original rule was:

```
startupFile = await getStartupFile();
if (startupFile) {
  await openPath(startupFile);   // CLI arg wins; do NOT restore session
} else {
  await restoreSessionOrNew();   // restore saved session, else one fresh untitled tab
}
```

## 9. Menu and keyboard

### Menu additions (`src/menu.ts`)

`MenuActions` gains three:

```ts
closeTab(): void;
nextTab(): void;
prevTab(): void;
```

File menu gets one new item after Save As…:

```
MenuItem "Close Tab"   accelerator "CmdOrCtrl+W"   action actions.closeTab
```

A new **Tabs** submenu (between View and Format) holds:

```
Submenu "Tabs"
  MenuItem "Next Tab"     accelerator "CmdOrCtrl+Tab"     action actions.nextTab
  MenuItem "Previous Tab" accelerator "CmdOrCtrl+Shift+Tab"   action actions.prevTab
```

(Placing Next/Prev under their own submenu keeps File uncluttered and matches the conceptual model.)

### Keyboard shortcuts (window-level)

`Ctrl+W` (close tab), `Ctrl+Tab` (next), `Ctrl+Shift+Tab` (prev) are bound via `window.addEventListener("keydown", ...)` in `main.ts`. These aren't editor-local keys (CodeMirror shouldn't see them); `Ctrl+W` in particular must call `event.preventDefault()` to override the browser's "close page" habit (irrelevant inside Tauri's webview but defensive). `Ctrl+N`, `Ctrl+O`, `Ctrl+S`, `Ctrl+Shift+S` continue to come through the existing Tauri menu accelerators.

### Touching the existing menu items

`newFile` and `openFile` actions still exist and route to `doNew` / `doOpen`, which now create/switch tabs instead of swapping the single buffer. The accelerator text and labels are unchanged.

## 10. Startup and shutdown flows

### Startup

```
1. loadSettings()
2. initStatusBar(...)                  // unchanged
3. restoreSessionOrNew():              // new
     const session = loadSession();
     if (session) for entry of session.entries:
        if entry.path:
          openPath(entry.path)         // re-reads from disk; dedup applies
        else:
          create untitled tab with entry.text as initial content
     switchTab(tabs[session.activeIndex].id)   // clamped
   else:
     doNew()                           // single untitled tab
4. startupFile = await getStartupFile()
     if (startupFile) openPath(startupFile)    // overrides session per §8 rule
                                                // NOTE: this is order-sensitive — see Open Issue R1
5. setupMenu(...)                      // unchanged items + new Tabs submenu
6. renderTabs(toTabViews())            // initial paint
```

**R1 — startup ordering.** Step 4 ("CLI file wins, skip session restore") has to be decided *before* step 3 runs, otherwise we restore the session and then pile the CLI file on top. Fix: **invert the check** — call `getStartupFile()` first, branch on whether it returns a path. The plan reflects this corrected order:

```
1. loadSettings, initStatusBar
2. startupFile = await getStartupFile()
3. if (startupFile) openPath(startupFile)
   else restoreSessionOrNew()
4. setupMenu
5. renderTabs, focus active
```

### Shutdown

`appWindow.onCloseRequested` handler is replaced:

```
event.preventDefault();
for each tab in runtime (in bar order):
  switchToTab(tab.id)                // show what we're asking about
  if (tab.meta.dirty):
    choice = await askSave(fileName(tab.meta))
    if (choice === "cancel") return;         // abort shutdown
    if (choice === "save"):
      await doSaveForTab(tab.id)
      if (tab.meta.dirty) return;            // save was cancelled (Save As dismissed)
    // "discard" falls through
saveSession(toSession(coll))                 // final snapshot
await appWindow.destroy()
```

After shutdown completes, `appWindow.destroy()` tears down the webview; localStorage has the final session already (we also persist on every tab mutation, so the destroy-time write is a safety net).

### When the last tab is closed

Per §8 "Tab close," closing the last tab creates a fresh untitled tab immediately — klad is never in an empty-editor state. Therefore the shutdown loop above only runs when the user invokes Exit / closes the window; it never runs just because the last open tab was closed.

## 11. Known limitations / future work

- **Multi-instance.** Two concurrently-running klad instances each maintain their own view of localStorage and overwrite the session on close. Last-writer-wins. Future fix: Tauri single-instance plugin forwarding argv to the running instance.
- **External file changes.** On session restore, named files are re-read from disk. If a file was deleted or moved externally between sessions, `readFile` returns an error and `openPath` shows `showError`; that entry is silently dropped (no zombie tab). Future: surface "file missing" as a recovery tab with the option to save the buffer somewhere new.
- **Per-tab cross-restart caret/scroll.** Not restored. Each tab's caret/scroll is preserved *within* a session (because the view stays alive) but lost across restart.
- **No tab cap.** Hundreds of huge tabs could starve memory. Not a real concern at klad's scale; revisit if it ever is.
- **No unsaved-buffer size cap.** Persisting a 10 MB untitled dirty buffer to localStorage will be slow. Defensive parse handles corrupt JSON; no size guard. Future: cap or move to a Rust-side session file.

## 12. Testing strategy

Conventions to follow (from existing `src/__tests__` and `fs_cmds.rs`):

- Pure-logic tests only. No Tauri IPC mocking, no CodeMirror mocking.
- One assertion-style `it` per behavior; small fixtures; defensive-parse coverage.

### `src/__tests__/tabs.test.ts`

Covers:

- `openTab` appends and sets active to the new id.
- `closeTab` picks next sibling as active; if last, picks previous; if no siblings, `activeId` is null.
- `switchTab` is a no-op for unknown ids and for the already-active id.
- `findTabByPath` matches by exact path string; returns null when absent.
- `nextTab` / `prevTab` wrap around a 3-tab collection.
- `genId` produces unique ids across successive calls.
- Open distinct paths → multiple tabs; open the same path twice → still one tab when going through `findTabByPath` first (the dedup lives in the orchestrator but the helper is exercised directly).

### `src/__tests__/session.test.ts`

Covers:

- `parseSession(null)` → null.
- `parseSession("not json")` → null.
- `parseSession('{"entries":[]}')` → null (empty session = no session).
- `parseSession` with a clean untitled entry (path null, no text) → that entry is dropped.
- `parseSession` with a dirty untitled entry (path null, text present) → entry kept.
- `parseSession` with `activeIndex` out of range → clamped.
- `parseSession` rejects entries with wrong types (encoding not a string, eol not LF/CRLF).
- Round-trip: `parseSession(JSON.stringify(s))` equals `s` for a representative `Session`.

### Backend tests

No Rust changes, no new backend tests.

### Manual smoke test (not part of automated suite, but in plan verification)

Open three files, edit two, close klad, reopen → all three return, the two edited come back with their unsaved text. Open a duplicate file → switches instead. Close a dirty tab → savePrompt. `Ctrl+Tab` cycles. Window title `*` matches the active tab's dot.

## 13. Catalog updates (per AGENTS.md)

Per the "Adding features, modules, or components" rule, here is every catalog that mentions the existing set and how this feature touches it:

| Catalog | Touched? | Change |
|---|---|---|
| `src-tauri/src/main.rs` `invoke_handler![]` | No | No new commands. |
| `src/fileio.ts` | No | Existing wrappers reused. |
| `src-tauri/tauri.conf.json` `fileAssociations` | No | No new file types. |
| `src-tauri/capabilities/default.json` | No | No new permissions. |
| `package.json` / `Cargo.toml` deps | No | No new deps. |
| `index.html` | **Yes** | `<div id="tabbar"></div>` added. |
| `src/menu.ts` | **Yes** | Three new `MenuActions`, one new submenu. |

No red flags: no new Tauri command exists whose frontend call could be missing; no two catalogs disagree about an item.

## 14. Resolved decisions summary

| Decision | Resolution |
|---|---|
| Tab engine architecture | Approach A — one `EditorView` per tab. |
| Session restore scope | Named files + dirty untitled buffers (text persisted). |
| Reopen of open file | Switch to existing tab, no duplicate. |
| Last-tab close | Immediately create a fresh untitled tab; editor never empty. |
| Multi-arg CLI startup | Out of scope (YAGNI without single-instance). |
| Single-instance mode | Out of scope (separate spec). |
| Drag-reorder / drag-drop | Out of scope (YAGNI). |
| Per-tab cross-restart caret/scroll | Out of scope. |
| Dark vs light tab styling | Light, to match klad's existing UI; screenshot was VS Code. |
| Startup ordering | Check `getStartupFile()` *first*; if present, skip session restore. |

## 15. Open issues

None. All questions surfaced during brainstorming are resolved in §14.
