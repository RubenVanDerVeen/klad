# Tabs and Session Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VS Code-style multi-tab editing (one tab per open file) plus session restore (reopen the same named files and any unsaved untitled buffers after restart) to klad.

**Architecture:** Approach A — one CodeMirror `EditorView` per tab, all children of `#editor`, only the active one visible. A pure-logic `tabs.ts` module owns the tab collection as immutable reducers; `main.ts` holds the runtime (each `TabState` paired with its live `EditorView`) and pushes the active tab's metadata to the existing status bar / title / preview. Session state persists to `localStorage` under `klad-session`, sibling to `klad-settings`.

**Tech Stack:** Tauri 2 shell, vanilla TypeScript, CodeMirror 6, Vitest (frontend), `@tauri-apps/api/window` + `@tauri-apps/plugin-dialog`. **No Rust changes, no new Tauri commands, no new deps, no new capabilities.**

**Spec:** `docs/artifacts/specs/tabs/2026-07-18-tabs-and-session-restore-design.md`

## Global Constraints

Copied verbatim from the spec and `AGENTS.md`:

- **Editor buffer is always LF-normalized.** CRLF/CR → `\n` before text reaches the editor; CRLF is applied only at save time. Never store CRLF in a CodeMirror buffer.
- **Encoding labels are a cross-process contract.** Status-bar dropdown values must match what Rust emits, verbatim (`"UTF-8"`, `"UTF-8 BOM"`, `"UTF-16 LE"`, `"UTF-16 BE"`, `"Windows-1252"`).
- **No web framework.** Vanilla DOM, native `<dialog>`, no React/Svelte.
- **Pure-logic tests only.** Existing convention (see `src/__tests__/settings.test.ts`): no Tauri IPC mocking, no CodeMirror mocking. DOM-logic modules (`statusbar.ts`, `tabbar.ts`) are not unit-tested.
- **Settings persist in browser `localStorage`** (frontend only); the Rust side has no settings concept. Session persistence follows the same pattern.
- **Conventional Commits 1.0.0.** Scope = module (`feat(tabs)`, `feat(session)`, `feat(tabbar)`, `feat(main)`). Plan-executing agents commit on their own at task boundaries per the AGENTS.md carve-out.
- **Run both test suites before claiming done:** `npm test` (vitest) and `cd src-tauri && cargo test`. Backend is unchanged here so cargo tests are a regression gate, not new tests.
- **Run `npm run build`** (TypeScript + Vite) before claiming any integration task is done.

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/tabs.ts` | Pure tab-collection reducers. No CodeMirror, no DOM. |
| `src/session.ts` | localStorage load/save/parse + `toSession` conversion. |
| `src/tabbar.ts` | Tab bar DOM build, render, event hooks. |
| `src/__tests__/tabs.test.ts` | Unit tests for `tabs.ts`. |
| `src/__tests__/session.test.ts` | Unit tests for `session.ts` parse + round-trip. |

### Modified files

| File | Responsibility change |
|---|---|
| `index.html` | Add `<div id="tabbar"></div>` as first child of `<body>`. |
| `src/styles.css` | Add tab bar styling. **Light theme** matching existing tokens. |
| `src/main.ts` | Replace single-`view` orchestration with `runtime` + `coll`. Replace `loadIntoEditor` with `switchToTab`, `openPath` with dedup, `onCloseRequested` with dirty-tab walk. Add session save/restore. Add keyboard listeners. |
| `src/menu.ts` | Add `closeTab`, `nextTab`, `prevTab` to `MenuActions`. Add File > Close Tab (`Ctrl+W`). Add Tabs submenu (Next Tab / Previous Tab). |

### Untouched (called out because AGENTS.md catalogs them)

`src-tauri/src/main.rs`, `src-tauri/src/fs_cmds.rs`, `src/fileio.ts`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `package.json`, `src-tauri/Cargo.toml`, `src/document.ts`, `src/editor.ts`, `src/statusbar.ts`, `src/preview.ts`, `src/render.ts`, `src/settings.ts`, `src/dialogs.ts`.

---

## Task 1: Pure tab-collection reducers

**Files:**
- Create: `src/tabs.ts`
- Test: `src/__tests__/tabs.test.ts`

**Interfaces:**
- Consumes: `DocMeta` from `src/document.ts` (unchanged).
- Produces: `TabState`, `TabCollection`, `newCollection`, `genId`, `openTab`, `closeTab`, `switchTab`, `findTabByPath`, `nextTab`, `prevTab`. Tasks 4–7 import these names verbatim.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/tabs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DocMeta } from "../document";
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
} from "../tabs";

function tab(path: string | null, id: string, dirty = false): TabState {
  const meta: DocMeta = {
    path,
    encoding: "UTF-8",
    eol: "LF",
    dirty,
  };
  return { id, meta };
}

describe("tabs collection", () => {
  it("openTab appends and activates the new tab", () => {
    const c = openTab(newCollection(), tab(null, "t1"));
    expect(c.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(c.activeId).toBe("t1");
  });

  it("closeTab picks the next sibling as active", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    c = openTab(c, tab(null, "t3"));
    c = switchTab(c, "t2");
    c = closeTab(c, "t2");
    expect(c.tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(c.activeId).toBe("t3");
  });

  it("closeTab on the last tab picks the previous sibling", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    c = switchTab(c, "t2");
    c = closeTab(c, "t2");
    expect(c.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(c.activeId).toBe("t1");
  });

  it("closeTab on the only tab yields an empty collection", () => {
    let c = openTab(newCollection(), tab(null, "t1"));
    c = closeTab(c, "t1");
    expect(c.tabs).toEqual([]);
    expect(c.activeId).toBeNull();
  });

  it("closeTab on a non-active tab leaves activeId unchanged", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    c = openTab(c, tab(null, "t3"));
    c = switchTab(c, "t3");
    c = closeTab(c, "t1"); // close a non-active, earlier tab
    expect(c.tabs.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(c.activeId).toBe("t3");
  });

  it("closeTab on an unknown id is a no-op", () => {
    const c = openTab(newCollection(), tab(null, "t1"));
    expect(closeTab(c, "nope")).toBe(c);
  });

  it("switchTab is a no-op for unknown or already-active id", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    const same = switchTab(c, "t2"); // already active
    expect(same).toBe(c);
    const unknown = switchTab(c, "nope");
    expect(unknown).toBe(c);
  });

  it("findTabByPath matches exact path", () => {
    let c = newCollection();
    c = openTab(c, tab("/a/b.txt", "t1"));
    c = openTab(c, tab(null, "t2"));
    expect(findTabByPath(c, "/a/b.txt")?.id).toBe("t1");
    expect(findTabByPath(c, "/nope")).toBeNull();
  });

  it("nextTab and prevTab wrap around", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    c = openTab(c, tab(null, "t3"));
    c = switchTab(c, "t1");
    c = prevTab(c);
    expect(c.activeId).toBe("t3");
    c = nextTab(c);
    expect(c.activeId).toBe("t1");
    c = nextTab(c);
    c = nextTab(c);
    expect(c.activeId).toBe("t3");
  });

  it("nextTab/prevTab are no-ops with fewer than 2 tabs", () => {
    const c = openTab(newCollection(), tab(null, "t1"));
    expect(nextTab(c)).toBe(c);
    expect(prevTab(c)).toBe(c);
  });

  it("genId produces distinct ids", () => {
    const ids = new Set([genId(), genId(), genId(), genId()]);
    expect(ids.size).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tabs`
Expected: FAIL with `Failed to resolve import "../tabs"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/tabs.ts`:

```ts
import { DocMeta } from "./document";

export interface TabState {
  id: string;
  meta: DocMeta;
  /** Present only when persisting a dirty untitled buffer to localStorage. */
  unsavedText?: string;
}

export interface TabCollection {
  tabs: TabState[];
  activeId: string | null;
}

let counter = 0;
export function genId(): string {
  counter += 1;
  return `t${counter}`;
}

export function newCollection(): TabCollection {
  return { tabs: [], activeId: null };
}

export function openTab(coll: TabCollection, tab: TabState): TabCollection {
  return { tabs: [...coll.tabs, tab], activeId: tab.id };
}

export function closeTab(coll: TabCollection, id: string): TabCollection {
  const idx = coll.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return coll;
  const tabs = coll.tabs.filter((t) => t.id !== id);
  // Closing a non-active tab leaves the active id alone.
  if (coll.activeId !== id) {
    return { tabs, activeId: coll.activeId };
  }
  // Closed the active tab: next sibling, else previous (when closing last), else null.
  let activeId: string | null = null;
  if (tabs.length > 0) {
    const nextIdx = Math.min(idx, tabs.length - 1);
    activeId = tabs[nextIdx].id;
  }
  return { tabs, activeId };
}

export function switchTab(coll: TabCollection, id: string): TabCollection {
  if (coll.activeId === id) return coll;
  if (!coll.tabs.some((t) => t.id === id)) return coll;
  return { ...coll, activeId: id };
}

export function findTabByPath(coll: TabCollection, path: string): TabState | null {
  return coll.tabs.find((t) => t.meta.path === path) ?? null;
}

export function nextTab(coll: TabCollection): TabCollection {
  if (coll.tabs.length < 2 || !coll.activeId) return coll;
  const idx = coll.tabs.findIndex((t) => t.id === coll.activeId);
  if (idx === -1) return coll;
  return { ...coll, activeId: coll.tabs[(idx + 1) % coll.tabs.length].id };
}

export function prevTab(coll: TabCollection): TabCollection {
  if (coll.tabs.length < 2 || !coll.activeId) return coll;
  const idx = coll.tabs.findIndex((t) => t.id === coll.activeId);
  if (idx === -1) return coll;
  const n = coll.tabs.length;
  return { ...coll, activeId: coll.tabs[(idx - 1 + n) % n].id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tabs`
Expected: PASS, all 11 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/tabs.ts src/__tests__/tabs.test.ts
git commit -m "feat(tabs): add pure tab-collection reducers"
```

---

## Task 2: Session persistence

**Files:**
- Create: `src/session.ts`
- Test: `src/__tests__/session.test.ts`

**Interfaces:**
- Consumes: `TabCollection`, `TabState` from `src/tabs.ts` (Task 1).
- Produces: `SessionEntry`, `Session`, `parseSession`, `loadSession`, `saveSession`, `clearSession`, `toSession`. Tasks 4–7 import these names verbatim.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DocMeta } from "../document";
import { openTab, switchTab, newCollection, TabState } from "../tabs";
import { parseSession, Session, toSession } from "../session";

function tab(path: string | null, id: string, dirty = false, unsavedText?: string): TabState {
  const meta: DocMeta = { path, encoding: "UTF-8", eol: "LF", dirty };
  return { id, meta, unsavedText };
}

describe("session parsing", () => {
  it("returns null for absent/corrupt input", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("not json")).toBeNull();
    expect(parseSession("{}")).toBeNull(); // no entries
    expect(parseSession('{"entries":[]}')).toBeNull();
    expect(parseSession('{"entries":"nope"}')).toBeNull();
    expect(parseSession('{"entries":[123]}')).toBeNull(); // entry not an object
  });

  it("drops clean untitled entries (path null, no text)", () => {
    const s = parseSession('{"entries":[{"path":null,"encoding":"UTF-8","eol":"LF"}]}');
    expect(s).toBeNull(); // all entries dropped => no session
  });

  it("keeps dirty untitled entries (path null, text present)", () => {
    const raw = '{"entries":[{"path":null,"encoding":"UTF-8","eol":"LF","text":"hi"}],"activeIndex":0}';
    const s = parseSession(raw);
    expect(s?.entries).toHaveLength(1);
    expect(s?.entries[0].text).toBe("hi");
    expect(s?.activeIndex).toBe(0);
  });

  it("rejects entries with wrong-typed fields", () => {
    const raw = '{"entries":[{"path":"/a","encoding":123,"eol":"LF"}]}';
    expect(parseSession(raw)).toBeNull();
  });

  it("rejects entries with bad eol", () => {
    const raw = '{"entries":[{"path":"/a","encoding":"UTF-8","eol":"CR"}]}';
    expect(parseSession(raw)).toBeNull();
  });

  it("clamps activeIndex into range", () => {
    const raw = '{"entries":[{"path":"/a","encoding":"UTF-8","eol":"LF"}],"activeIndex":99}';
    const s = parseSession(raw);
    expect(s?.activeIndex).toBe(0);
  });

  it("clamps negative activeIndex to 0", () => {
    const raw = '{"entries":[{"path":"/a","encoding":"UTF-8","eol":"LF"}],"activeIndex":-3}';
    const s = parseSession(raw);
    expect(s?.activeIndex).toBe(0);
  });

  it("round-trips a representative session", () => {
    let coll = newCollection();
    coll = openTab(coll, tab("/a.txt", "t1"));
    coll = openTab(coll, tab(null, "t2", true, "unsaved edits"));
    coll = openTab(coll, tab("/b.md", "t3"));
    coll = switchTab(coll, "t3");
    const s = toSession(coll);
    const json = JSON.stringify(s);
    const back = parseSession(json);
    expect(back).toEqual(s);
  });

  it("toSession omits text for clean untitled tabs and for named tabs", () => {
    let coll = newCollection();
    coll = openTab(coll, tab(null, "t1", false)); // clean untitled
    coll = openTab(coll, tab("/x.txt", "t2", true)); // dirty named (text would come from disk)
    const s = toSession(coll);
    expect(s.entries[0].text).toBeUndefined();
    expect(s.entries[1].text).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- session`
Expected: FAIL with `Failed to resolve import "../session"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/session.ts`:

```ts
import { TabCollection } from "./tabs";

export interface SessionEntry {
  path: string | null;
  encoding: string;
  eol: "LF" | "CRLF";
  /** Present only for untitled dirty buffers being persisted. */
  text?: string;
}

export interface Session {
  entries: SessionEntry[];
  activeIndex: number;
}

const KEY = "klad-session";

export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) return null;

  const entries: SessionEntry[] = [];
  for (const e of obj.entries) {
    if (typeof e !== "object" || e === null) continue;
    const eo = e as Record<string, unknown>;
    if (eo.path !== null && typeof eo.path !== "string") continue;
    if (typeof eo.encoding !== "string") continue;
    if (eo.eol !== "LF" && eo.eol !== "CRLF") continue;
    const text = typeof eo.text === "string" ? eo.text : undefined;
    // Drop clean untitled tabs (no path AND no text).
    if (eo.path === null && text === undefined) continue;
    entries.push({
      path: eo.path as string | null,
      encoding: eo.encoding,
      eol: eo.eol,
      text,
    });
  }
  if (entries.length === 0) return null;

  let activeIndex =
    typeof obj.activeIndex === "number" && Number.isFinite(obj.activeIndex)
      ? Math.floor(obj.activeIndex)
      : 0;
  if (activeIndex < 0) activeIndex = 0;
  if (activeIndex > entries.length - 1) activeIndex = entries.length - 1;
  return { entries, activeIndex };
}

export function loadSession(): Session | null {
  try {
    return parseSession(
      typeof localStorage === "undefined" ? null : localStorage.getItem(KEY),
    );
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // best-effort: storage unavailable or full
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function toSession(coll: TabCollection): Session {
  const entries: SessionEntry[] = coll.tabs.map((t) => {
    const entry: SessionEntry = {
      path: t.meta.path,
      encoding: t.meta.encoding,
      eol: t.meta.eol,
    };
    // Persist text only for untitled dirty buffers (caller sets unsavedText).
    if (t.meta.path === null && t.meta.dirty) {
      entry.text = t.unsavedText ?? "";
    }
    return entry;
  });
  const activeIdx = coll.activeId
    ? coll.tabs.findIndex((t) => t.id === coll.activeId)
    : -1;
  return { entries, activeIndex: Math.max(0, activeIdx) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- session`
Expected: PASS, all 9 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/session.ts src/__tests__/session.test.ts
git commit -m "feat(session): add localStorage session persistence"
```

---

## Task 3: Tab bar DOM module + HTML/CSS slot

**Files:**
- Create: `src/tabbar.ts`
- Modify: `index.html`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: nothing (pure DOM module).
- Produces: `TabView`, `TabBarHooks`, `initTabBar`, `renderTabs`. Task 4 imports these names verbatim.

This module follows the convention of `src/statusbar.ts` (DOM built dynamically, push-driven from `main.ts`, no unit test). Verification is by build + visual smoke.

- [ ] **Step 1: Add the HTML slot**

Edit `index.html`. Replace the `<body>` opening + `<main id="content">` block:

```html
  <body>
    <div id="tabbar"></div>
    <main id="content">
      <div id="editor"></div>
      <div id="preview" hidden></div>
    </main>
```

(The `<div id="tabbar"></div>` is the only new line; it goes between `<body>` and `<main id="content">`.)

- [ ] **Step 2: Add the CSS**

Append to `src/styles.css`:

```css
/* Tab bar */
#tabbar {
  display: flex;
  align-items: stretch;
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
  padding: 4px 4px 4px 12px;
  cursor: default;
  border-right: 1px solid #e8e8e8;
  white-space: nowrap;
  user-select: none;
}
.tab:hover { background: #eaeaea; }
.tab.active {
  background: #fff;
  box-shadow: inset 0 2px 0 #0078d4;
}
.tab-label { color: #444; }
.tab.active .tab-label { color: #000; }
.tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0078d4;
  display: none;
}
.tab[data-dirty="true"] .tab-dot { display: inline-block; }
.tab-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #666;
  padding: 0 4px;
  font-size: 14px;
  line-height: 1;
  border-radius: 3px;
}
.tab-close:hover { background: #d0d0d0; color: #000; }
#new-tab {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  padding: 0 8px;
  color: #444;
  align-self: center;
  border-radius: 3px;
}
#new-tab:hover { background: #e0e0e0; }
```

- [ ] **Step 3: Create the tabbar module**

Create `src/tabbar.ts`:

```ts
export interface TabView {
  id: string;
  label: string;
  dirty: boolean;
  active: boolean;
}

export interface TabBarHooks {
  onSwitch(id: string): void;
  onClose(id: string): void;
  onNew(): void;
}

let bar: HTMLElement;
let newBtn: HTMLButtonElement;

export function initTabBar(hooks: TabBarHooks): void {
  bar = document.getElementById("tabbar")!;
  bar.innerHTML = "";
  newBtn = document.createElement("button");
  newBtn.id = "new-tab";
  newBtn.type = "button";
  newBtn.title = "New tab (Ctrl+N)";
  newBtn.textContent = "+";
  newBtn.onclick = () => hooks.onNew();
  bar.appendChild(newBtn);
}

export function renderTabs(views: TabView[]): void {
  // Remove existing .tab elements but keep the trailing #new-tab.
  for (const el of Array.from(bar.querySelectorAll(".tab"))) el.remove();

  for (const v of views) {
    const t = document.createElement("div");
    t.className = "tab" + (v.active ? " active" : "");
    t.dataset.id = v.id;
    t.dataset.dirty = v.dirty ? "true" : "false";

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = v.label;
    t.appendChild(label);

    const dot = document.createElement("span");
    dot.className = "tab-dot";
    t.appendChild(dot);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.title = "Close (Ctrl+W)";
    close.textContent = "\u00d7"; // multiplication sign, reads as "×"
    close.onclick = (e) => {
      e.stopPropagation();
      hooks_onClose(v.id);
    };
    t.appendChild(close);

    t.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".tab-close")) return;
      hooks_onSwitch(v.id);
    });
    t.addEventListener("auxclick", (e) => {
      // Middle-click closes (button === 1)
      if ((e as MouseEvent).button === 1) hooks_onClose(v.id);
    });

    bar.insertBefore(t, newBtn);
  }
}

// Module-scoped hook storage so the closures above can be added imperatively.
let hooks_onSwitch: (id: string) => void = () => {};
let hooks_onClose: (id: string) => void = () => {};
let hooks_onNew: () => void = () => {};

// Re-export init to also capture hooks (overwrite the simpler version above).
```

The "two init" sketch above is awkward — replace the entire file contents with the consolidated version below. (The intermediate sketch is shown only to make the consolidation explicit.)

**Final `src/tabbar.ts` (overwrite the file with this):**

```ts
export interface TabView {
  id: string;
  label: string;
  dirty: boolean;
  active: boolean;
}

export interface TabBarHooks {
  onSwitch(id: string): void;
  onClose(id: string): void;
  onNew(): void;
}

let bar: HTMLElement;
let newBtn: HTMLButtonElement;
const hooks: TabBarHooks = {
  onSwitch: () => {},
  onClose: () => {},
  onNew: () => {},
};

export function initTabBar(h: TabBarHooks): void {
  hooks.onSwitch = h.onSwitch;
  hooks.onClose = h.onClose;
  hooks.onNew = h.onNew;
  bar = document.getElementById("tabbar")!;
  bar.innerHTML = "";
  newBtn = document.createElement("button");
  newBtn.id = "new-tab";
  newBtn.type = "button";
  newBtn.title = "New tab (Ctrl+N)";
  newBtn.textContent = "+";
  newBtn.onclick = () => hooks.onNew();
  bar.appendChild(newBtn);
}

export function renderTabs(views: TabView[]): void {
  for (const el of Array.from(bar.querySelectorAll(".tab"))) el.remove();
  for (const v of views) {
    const t = document.createElement("div");
    t.className = "tab" + (v.active ? " active" : "");
    t.dataset.id = v.id;
    t.dataset.dirty = v.dirty ? "true" : "false";

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = v.label;
    t.appendChild(label);

    const dot = document.createElement("span");
    dot.className = "tab-dot";
    t.appendChild(dot);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.title = "Close (Ctrl+W)";
    close.textContent = "\u00d7";
    close.onclick = (e) => {
      e.stopPropagation();
      hooks.onClose(v.id);
    };
    t.appendChild(close);

    t.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".tab-close")) return;
      hooks.onSwitch(v.id);
    });
    t.addEventListener("auxclick", (e) => {
      if ((e as MouseEvent).button === 1) hooks.onClose(v.id);
    });

    bar.insertBefore(t, newBtn);
  }
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add index.html src/styles.css src/tabbar.ts
git commit -m "feat(tabbar): add tab bar DOM module and styling"
```

---

## Task 4: Multi-tab core in `main.ts` (refactor + open/new/switch with single-tab parity)

**Files:**
- Modify: `src/main.ts` (substantial — replace single-`view` orchestration with `runtime` + `coll`)

**Interfaces:**
- Consumes: `tabs.ts` (Task 1), `tabbar.ts` (Task 3). Uses existing `editor.ts`, `document.ts`, `fileio.ts`, `dialogs.ts`, `statusbar.ts`, `preview.ts`.
- Produces: a working multi-tab `main.ts` with single-tab behavioral parity (open one file → one tab; same status bar / title / preview / save / save-as behavior). Multi-tab open/close/restore come in Tasks 5–7.

This is integration work against CodeMirror + Tauri; per project convention there are no unit tests for `main.ts`. Verification is `npm run build` + manual smoke. Each step below lists the exact replacement code.

- [ ] **Step 1: Update imports**

Edit the top of `src/main.ts`. Replace the existing import block (lines 1–17 currently) with:

```ts
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
```

- [ ] **Step 2: Replace the singleton `meta` + `view` with runtime/coll**

Replace the block at lines 24–25 (`let meta: DocMeta = newDoc();` and `const appWindow = getCurrentWindow();`) with:

```ts
const appWindow = getCurrentWindow();
const settings: Settings = loadSettings();

interface RuntimeTab extends TabState {
  view: EditorView;
}

let coll: TabCollection = newCollection();
let runtime: RuntimeTab[] = [];
let meta: DocMeta = newDoc(); // alias of activeTab().meta; rebound on switch
```

(Remove the now-duplicate `const settings: Settings = loadSettings();` line that was at line 27 of the old file — it's consolidated above.)

- [ ] **Step 3: Add active-tab helper and tab-bar view projection**

Add immediately after the `runtime` declaration:

```ts
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
```

- [ ] **Step 4: Replace `createEditor` call site with a per-tab factory**

Delete the existing single-view `createEditor(...)` block (lines 77–88 in the old file). Replace with a factory:

```ts
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
```

Note: `createEditor` is called with the **same parent** (`#editor`) for every tab; CodeMirror appends each new `.cm-editor` as a sibling. We hide all newly created views until `switchToTab` reveals them.

- [ ] **Step 5: Replace `loadIntoEditor` with `switchToTab` + tab creation helpers**

Delete the existing `loadIntoEditor` function (lines 115–123 of the old file). Replace with:

```ts
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
```

- [ ] **Step 6: Add a `scheduleSessionSave` stub (filled in Task 7)**

Below `appendAndActivate`:

```ts
// ponytail: stubbed here, real debounce added in Task 7. For now, no-op.
function scheduleSessionSave(): void {
  /* filled in Task 7 */
}
```

- [ ] **Step 7: Rewrite `doNew` to create a tab (no discard prompt — old prompt was a single-doc concern)**

Replace the existing `doNew` (old lines 135–138) with:

```ts
async function doNew(): Promise<void> {
  appendAndActivate(createTab("", newDoc()));
}
```

- [ ] **Step 8: Rewrite `openPath` with dedup**

Replace the existing `openPath` (old lines 140–152) with:

```ts
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
```

- [ ] **Step 9: Rewrite `doOpen` (drop the discard prompt — opening a file no longer disturbs the current tab)**

Replace the existing `doOpen` (old lines 154–158) with:

```ts
async function doOpen(): Promise<void> {
  const path = await openDialog({ multiple: false, filters: FILTERS });
  if (typeof path === "string") await openPath(path);
}
```

- [ ] **Step 10: Rewrite `doSave` / `doSaveAs` to use the active tab's view**

Replace the existing `doSave` and `doSaveAs` (old lines 160–189) with:

```ts
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
```

- [ ] **Step 11: Update `confirmDiscard` to operate on the active tab**

The existing `confirmDiscard` (old lines 126–133) reads `meta.dirty` and calls `doSave()`. Both now operate on the active tab automatically (since `meta` is the active tab's alias and `doSave` uses `activeTab()`). The body is unchanged — keep as-is. Verify the existing function reads:

```ts
async function confirmDiscard(): Promise<boolean> {
  if (!meta.dirty) return true;
  const choice = await askSave(fileName(meta));
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  await doSave();
  return !meta.dirty; // save may have been cancelled in the Save As dialog
}
```

- [ ] **Step 12: Update `isMarkdown` and `applyPreviewMode` to use active tab's view**

The existing functions (old lines 104–113) read `meta` and `view`. `meta` already works (alias). Replace `getText(view)` with `getText(activeTab().view)`:

```ts
function isMarkdown(m: DocMeta): boolean {
  return /\.(md|markdown)$/i.test(m.path ?? "");
}

function applyPreviewMode(): void {
  const on = isMarkdown(meta);
  setPreviewVisible(on);
  if (on) renderPreviewNow(getText(activeTab().view));
  void menuHandles?.previewItem.setChecked(on);
}
```

- [ ] **Step 13: Update the zoom wheel handler and the preview-scroll handler to use active view**

Replace the existing `view.scrollDOM.addEventListener("wheel", …)` block (old lines 90–98) with:

```ts
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
```

Replace the existing `view.scrollDOM.addEventListener("scroll", …)` block (old lines 224–226) with:

```ts
document.getElementById("editor")!.addEventListener(
  "scroll",
  () => {
    if (isPreviewVisible()) syncPreviewScroll(activeScrollDom());
  },
  true, // capture: scrollers are nested inside #editor
);
```

- [ ] **Step 14: Update the menu actions block**

In the `setupMenu({...}, settings.wrap)` call (old lines 192–219), update the actions that referenced `view` directly:

- `find: () => openSearchPanel(view)` → `find: () => openSearchPanel(activeTab().view)`
- `replace: () => openSearchPanel(view)` → `replace: () => openSearchPanel(activeTab().view)`
- `goToLine: () => gotoLine(view)` → `goToLine: () => gotoLine(activeTab().view)`
- `togglePreview: (on) => { setPreviewVisible(on); if (on) renderPreviewNow(getText(view)); }` →
  `togglePreview: (on) => { setPreviewVisible(on); if (on) renderPreviewNow(getText(activeTab().view)); }`

The other actions (`setWrap`, `zoomIn`, etc.) need a small change for `setWrap` — it currently does `setWrap(view, on)` for the single view; with N views it must reconfigure all of them:

Replace:

```ts
setWrap: (on) => {
  settings.wrap = on;
  setWrap(view, on);
  saveSettings(settings);
},
```

with:

```ts
setWrap: (on) => {
  settings.wrap = on;
  for (const t of runtime) setWrap(t.view, on);
  saveSettings(settings);
},
```

- [ ] **Step 15: Update the font-dialog OK handler**

In `openFontDialog` (old line 72), `view.focus()` becomes `activeTab().view.focus()`.

- [ ] **Step 16: Initialize the tab bar and create the first tab**

Replace the existing `void getStartupFile().then(...)` block at the bottom (old lines 236–238) and the trailing `view.focus();` (old line 240) with the **initial bootstrap** that creates one tab for now (multi-tab restore comes in Task 7):

```ts
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
```

Note: the very first `appendAndActivate` creates a tab before `getStartupFile` resolves; if a startup file exists, `openPath` adds a second tab. Task 7 changes this to skip the placeholder when a startup file or session is pending. For Task 4 this is acceptable (manual smoke: launching without args shows one untitled tab; launching with a file shows two tabs — the placeholder plus the file).

- [ ] **Step 17: Update `onCloseRequested` to a temporary version (Task 7 will finish it)**

Replace the existing `onCloseRequested` (old lines 228–234) with a minimal version that prompts for the active tab only (good enough for Task 4's single-tab parity smoke; Task 7 generalizes to all tabs):

```ts
void appWindow.onCloseRequested(async (event) => {
  if (!meta.dirty) return; // allow close
  event.preventDefault();
  if (await confirmDiscard()) {
    await appWindow.destroy();
  }
});
```

- [ ] **Step 18: Verify build and run**

Run: `npm run build`
Expected: build succeeds.

Run: `npm test`
Expected: all existing tests still pass (no regressions in `document.test.ts`, `settings.test.ts`, `render.test.ts`, `debounce.test.ts`); new tests from Tasks 1–2 pass.

Manual smoke (in `npm run tauri dev`):
- Launch with no args → one "Untitled" tab appears in the bar, editable.
- Type text → dirty dot appears, title gets `*` prefix.
- File > Open a file → second tab appears, file content loads, switches to it.
- File > Open the same file again → no new tab, stays on existing.
- Save / Save As work on the active tab; dirty clears.
- Click a tab → switches; status bar / title / preview update.
- Click `+` → new untitled tab.
- Word-wrap menu toggle applies to all tabs.
- Close-reopen the app → only the Untitled tab comes back (Task 7 fixes session restore).

- [ ] **Step 19: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): refactor to multi-tab runtime with single-tab parity"
```

---

## Task 5: Tab close (with dirty-confirm) and last-tab-fresh behavior

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `closeTab`, `switchTab` from `tabs.ts`; `askSave` from `dialogs.ts`; existing `doSave` from Task 4.
- Produces: `closeTabById(id: string): Promise<void>` used by the tab bar's `onClose` hook (Task 4 references it — it doesn't exist yet; this task adds it).

- [ ] **Step 1: Add `closeTabById`**

Add this function to `src/main.ts` (anywhere after `activeTab` / `runtime` are declared; near `switchToTab` is natural):

```ts
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
```

- [ ] **Step 2: Verify build and smoke**

Run: `npm run build`
Expected: succeeds.

Run: `npm test`
Expected: all green (no test changes).

Manual smoke:
- Two clean tabs → click `×` on the active → second tab activates, no prompt.
- Dirty tab → click `×` → savePrompt appears. Cancel → tab stays. Don't Save → tab closes, work lost. Save (with path) → tab saves and closes. Save As (untitled) → dismiss dialog → tab stays.
- Close the last tab → a fresh untitled tab is immediately created.
- Middle-click a tab → closes (same path as `×`).

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(tabs): close tab with dirty-confirm and last-tab-fresh fallback"
```

---

## Task 6: Keyboard shortcuts and menu additions

**Files:**
- Modify: `src/main.ts` (window-level keydown listeners)
- Modify: `src/menu.ts` (new actions and Tabs submenu)

**Interfaces:**
- Consumes: `nextTab`, `prevTab` from `tabs.ts`; `closeTabById` from Task 5; `doNew` from Task 4.
- Produces: three new entries on `MenuActions` (`closeTab`, `nextTab`, `prevTab`) that `main.ts` wires up.

- [ ] **Step 1: Extend `MenuActions` and add the Tabs submenu**

Edit `src/menu.ts`. Add three methods to the `MenuActions` interface (after `togglePreview`):

```ts
  closeTab(): void;
  nextTab(): void;
  prevTab(): void;
```

Inside `setupMenu`, after the `fileMenu` declaration (which currently ends with the Exit item), insert a `Close Tab` item before the separator+Exit. Replace:

```ts
      await MenuItem.new({ id: "print", text: "Print…", accelerator: "CmdOrCtrl+P", action: actions.print }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "exit", text: "Exit", action: actions.exit }),
```

with:

```ts
      await MenuItem.new({ id: "print", text: "Print…", accelerator: "CmdOrCtrl+P", action: actions.print }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "closeTab", text: "Close Tab", accelerator: "CmdOrCtrl+W", action: actions.closeTab }),
      await MenuItem.new({ id: "exit", text: "Exit", action: actions.exit }),
```

(Removed the second separator before Exit to keep the menu tidy; Close Tab sits next to Exit.)

Then add a new Tabs submenu. After the `formatMenu` declaration and before the `Menu.new({ items: [...] })` call, add:

```ts
  const tabsMenu = await Submenu.new({
    text: "Tabs",
    items: [
      await MenuItem.new({ id: "nextTab", text: "Next Tab", accelerator: "CmdOrCtrl+Tab", action: actions.nextTab }),
      await MenuItem.new({ id: "prevTab", text: "Previous Tab", accelerator: "CmdOrCtrl+Shift+Tab", action: actions.prevTab }),
    ],
  });
```

Update the final `Menu.new` items array:

```ts
  const menu = await Menu.new({ items: [fileMenu, editMenu, viewMenu, tabsMenu, formatMenu] });
```

- [ ] **Step 2: Wire the new actions in `main.ts`**

In the `setupMenu({...}, settings.wrap)` call, add the three new actions inside the actions object (e.g., after `togglePreview`):

```ts
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
```

- [ ] **Step 3: Add window-level keydown listener as a defense-in-depth**

The Tauri menu accelerators (`CmdOrCtrl+W`, `CmdOrCtrl+Tab`, `CmdOrCtrl+Shift+Tab`) deliver key presses to the actions on all platforms. As a defense against any platform where the menu accelerator doesn't fire (and to ensure Ctrl+Tab/Shift+Tab behave even if the menu is hidden), also bind window-level listeners.

Add near the bottom of `src/main.ts` (after the `initTabBar(...)` call):

```ts
window.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  if (e.key === "w" || e.key === "W") {
    e.preventDefault();
    const id = coll.activeId;
    if (id) void closeTabById(id);
  } else if (e.key === "Tab") {
    e.preventDefault();
    const target = e.shiftKey ? prevTab(coll) : nextTab(coll);
    if (target.activeId && target.activeId !== coll.activeId) switchToTab(target.activeId);
  }
});
```

- [ ] **Step 4: Verify build and smoke**

Run: `npm run build`
Expected: succeeds.

Manual smoke:
- `Ctrl+W` closes the active tab (with prompt if dirty).
- `Ctrl+Tab` cycles forward through tabs (wraps from last to first).
- `Ctrl+Shift+Tab` cycles backward.
- Menu shows File > Close Tab and a Tabs submenu with Next/Previous Tab.
- Clicking the menu items works identically to the keys.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/menu.ts
git commit -m "feat(tabs): add keyboard shortcuts and Tabs menu"
```

---

## Task 7: Session save, restore, and shutdown dirty-walk

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Session`, `loadSession`, `saveSession`, `toSession` from `session.ts` (Task 2); `getStartupFile` from `fileio.ts`; existing `tabs.ts`, `tabbar.ts`, all Task 4–6 functions.
- Produces: a complete session-restore experience. No further tasks depend on this.

- [ ] **Step 1: Replace the `scheduleSessionSave` stub with a debounced implementation**

In `src/main.ts`, replace the stub:

```ts
// ponytail: stubbed here, real debounce added in Task 7. For now, no-op.
function scheduleSessionSave(): void {
  /* filled in Task 7 */
}
```

with:

```ts
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
  // Sync unsavedText on dirty untitled tabs so the snapshot captures their latest content.
  for (const t of runtime) {
    if (t.meta.path === null && t.meta.dirty) {
      t.unsavedText = getText(t.view);
    } else {
      t.unsavedText = undefined;
    }
  }
  saveSession(toSession(coll));
}
```

The debounce collapses bursts of saves (rapid tab switches, typing). 250 ms matches `preview.ts`'s debounce order of magnitude.

- [ ] **Step 2: Replace the bootstrap with proper startup-File-then-session logic**

Replace the Task 4 bootstrap (the `appendAndActivate(createTab("", newDoc()));` line plus the `getStartupFile` block) with:

```ts
void (async () => {
  const startupFile = await getStartupFile();
  if (startupFile) {
    // CLI file arg wins; skip session restore (see spec §8 multi-instance rule).
    await openPath(startupFile);
  } else {
    await restoreSessionOrNew();
  }
})();

async function restoreSessionOrNew(): Promise<void> {
  const session = loadSession();
  if (!session) {
    appendAndActivate(createTab("", newDoc()));
    return;
  }
  for (const entry of session.entries) {
    if (entry.path) {
      // Re-read named files from disk (picks up external edits). Dedup applies.
      await openPath(entry.path);
    } else {
      // Untitled dirty buffer: restore text from the session blob.
      const meta: DocMeta = {
        path: null,
        encoding: entry.encoding,
        eol: entry.eol,
        dirty: true, // still unsaved
      };
      appendAndActivate(createTab(entry.text ?? "", meta));
    }
  }
  // Activate the tab the user had active (clamped index).
  const targetId = coll.tabs[session.activeIndex]?.id;
  if (targetId && targetId !== coll.activeId) {
    switchToTab(targetId);
  }
}
```

Note: each `appendAndActivate` and `openPath` activates its own tab as it runs, so after the loop the last-opened tab is active. The final `switchToTab(targetId)` flips to the restored active index.

- [ ] **Step 3: Replace the `onCloseRequested` handler with the dirty-tab walk + final session save**

Replace the temporary Task 4 handler:

```ts
void appWindow.onCloseRequested(async (event) => {
  if (!meta.dirty) return; // allow close
  event.preventDefault();
  if (await confirmDiscard()) {
    await appWindow.destroy();
  }
});
```

with:

```ts
void appWindow.onCloseRequested(async (event) => {
  event.preventDefault();
  for (const t of runtime) {
    if (!t.meta.dirty) continue;
    // Show the tab so the user sees what they're being asked about.
    if (coll.activeId !== t.id) switchToTab(t.id);
    const choice = await askSave(fileName(t.meta));
    if (choice === "cancel") return; // abort shutdown
    if (choice === "save") {
      // doSave targets activeTab(), which we just switched to.
      await doSave();
      if (t.meta.dirty) return; // save was cancelled in Save As
    }
    // "discard" falls through to the next tab
  }
  persistSessionNow();
  await appWindow.destroy();
});
```

- [ ] **Step 4: Verify build and full test suite**

Run: `npm run build`
Expected: succeeds.

Run: `npm test`
Expected: all green (no test changes in this task).

Run: `cd src-tauri && cargo test`
Expected: all 11 backend tests pass (unchanged — regression gate only).

- [ ] **Step 5: Manual smoke — full session-restore walkthrough**

In `npm run tauri dev`:

1. Launch with no args → one untitled tab.
2. Open three files from disk (File > Open). Edit two of them. Create a fourth "Untitled" tab with text. Switch to the third file's tab.
3. Close the app window.
4. Reopen.
5. Verify: all three named files reopen (re-read from disk), the two edited ones come back with the saved dirty `*` and their edits intact (note: they were never saved to their files; their text came from the session blob), the Untitled tab comes back with its text and dirty dot, the active tab is the third file (matching step 2).
6. Close a dirty tab via `×` → savePrompt appears. Cancel keeps it. Don't Save removes it without persisting further.
7. Launch `klad somefile.txt` from a terminal (if practical on the dev setup) → only that file opens; session is not restored (multi-instance rule).
8. Open DevTools (`F12` if available in the dev webview), inspect `localStorage.getItem("klad-session")` → see the JSON shape matches `Session` from the spec.
9. Corrupt the localStorage value manually (e.g., set it to `"not json"`) and reload → klad falls back to a single untitled tab (parseSession returns null), no crash.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(session): save, restore, and shutdown dirty-walk"
```

---

## Final verification

After Task 7:

- [ ] Run `npm run build` — succeeds with no TypeScript errors.
- [ ] Run `npm test` — all green (existing + new `tabs.test.ts` + `session.test.ts`).
- [ ] Run `cd src-tauri && cargo test` — all green (regression only).
- [ ] Run `npm run tauri dev` and complete the full smoke walkthrough from Task 7 Step 5.

## Self-review notes

(Planner's own check against the spec — kept here so reviewers see the reasoning.)

- **Spec §5 (data model):** `TabState` and `TabCollection` → Task 1. `Session` and `SessionEntry` → Task 2. `RuntimeTab` → Task 4 Step 2.
- **Spec §6 (module structure):** every new and modified file listed there is created/edited by some task. The "untouched" list is honored (no Rust changes anywhere).
- **Spec §7 (UI design / DOM / CSS):** Task 3 implements the slot, the DOM, and the light-theme styling.
- **Spec §8 (behaviors: open / close / switch / dirty / save-as / multi-instance):** Task 4 (open dedup, switch, new), Task 5 (close with dirty confirm, last-tab-fresh), Tasks 4 + 5 (per-tab dirty tracking via the closure-captured `owner.meta`), Task 4 Step 10 (save / save-as on active tab), Task 7 Step 2 (multi-instance: CLI arg wins).
- **Spec §9 (menu + keyboard):** Task 6.
- **Spec §10 (startup / shutdown):** Task 7 Steps 2 and 3.
- **Spec §11 (known limitations):** documented in spec, no tasks needed (YAGNI/non-goals).
- **Spec §12 (testing):** Tasks 1 and 2 cover the pure-logic suites. Tasks 4–7 use build + smoke per project convention.
- **Spec §13 (catalog updates):** explicitly enumerated in the Global Constraints and File Structure above; no Rust-side catalog touched.
- **No placeholders** in any task step.
- **Type consistency:** `TabState`, `TabCollection`, `RuntimeTab`, `Session`, `SessionEntry`, `TabView`, `TabBarHooks` are spelled the same way across tasks. `closeTabById`, `switchToTab`, `appendAndActivate`, `createTab`, `scheduleSessionSave`, `persistSessionNow`, `restoreSessionOrNew`, `paintTabBar`, `toTabViews`, `activeTab` all match across task boundaries.

## Open issues

None. The spec's §15 is empty and this plan covers every §14 resolved decision.
