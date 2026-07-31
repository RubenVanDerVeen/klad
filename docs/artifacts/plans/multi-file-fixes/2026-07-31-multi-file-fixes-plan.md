# Multi-file / dirty-state / close-prompt fixes — Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per-task: write failing test (when applicable) → implement → verify → Conventional Commit. Two-strike failures escalate to the oracle.

**Goal:** Fix three multi-tab bugs — (1) editor text doesn't change on tab switch, (2) opening a file falsely marks it dirty, (3) close prompts unchanged files and named-file unsaved edits aren't remembered — so tabs switch correctly, only real edits mark dirty, and unsaved edits to any file survive restart.

**Architecture:** Bug 1 is a one-line CSS override (CodeMirror's `.cm-editor { display: flex !important }` defeats the `hidden` attribute). Bug 2 tags programmatic `setText` loads with a CodeMirror `Annotation` so the dirty listener ignores them. Bug 3 widens the existing localStorage hot-exit from untitled-only to all dirty buffers, restores dirty named buffers from the blob instead of re-reading disk, and makes "Don't Save" a true discard.

**Tech Stack:** Vanilla TypeScript, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`), Vite 6, Vitest 3 (jsdom available), Tauri 2, Rust 2021 backend (unchanged).

**Spec:** `docs/artifacts/specs/multi-file-fixes/2026-07-31-multi-file-fixes-design.md`

## Global Constraints

- **Branch:** `fix/multi-file-tabs`, cut from latest `main`.
- **LF-only buffer:** the CodeMirror buffer is always LF-normalized; CRLF is a save-time concern. Restored buffer text is already LF (it came from the editor) — do not re-normalize.
- **No new dependencies.** `Annotation` comes from the already-installed `@codemirror/state`. Do not add packages.
- **Encoding labels are a verbatim cross-process contract** — this plan does not touch them, but do not rename/case them anywhere.
- **Conventional Commits 1.0.0**, scope = module (e.g. `fix(editor):`, `feat(session):`), never the discipline.
- **Catalogs:** no new Tauri command / file association / capability / dialog markup. `src-tauri/src/main.rs`, `src/fileio.ts`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `index.html` must NOT be modified by this plan.
- **Verification gate before "done":** both `npm test` and `cargo test` pass, plus `npx tsc --noEmit` is clean, plus the manual smoke checklist (Task 6).
- Mark deliberate shortcuts with a `// ponytail:` comment naming the ceiling and upgrade path.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/styles.css` | Editor pane layout | +1 rule to make `hidden` work on `.cm-editor` |
| `src/editor.ts` | CodeMirror factory + text accessors | Add `Annotation`; gate dirty listener; annotate `setText` |
| `src/__tests__/editor.test.ts` | NEW — editor-layer unit test (jsdom) | Assert programmatic load isn't dirty, user edit is |
| `src/session.ts` | Session (de)serialization | `toSession` persists text for all dirty tabs; comment updates |
| `src/tabs.ts` | Tab state types | `unsavedText` comment update |
| `src/main.ts` | App orchestration | `persistSessionNow` syncs all dirty buffers; `restoreSessionOrNew` restores dirty named buffers (with dedup); `onCloseRequested` discard → `dirty=false` |
| `src/__tests__/session.test.ts` | Session unit tests | Update toSession expectations; add dirty-named round-trip |

No new modules; responsibilities stay where they are.

---

## Task 1: CSS — make `hidden` hide inactive editors (Bug 1)

**Files:**
- Modify: `src/styles.css` (after the `#editor .cm-editor { height: 100% }` block, currently lines 49-51)

**Interfaces:** none (pure presentation).

**Why:** `showOnly()` (`src/main.ts:188-193`) hides inactive editors with the `hidden` attribute, but CodeMirror's baseTheme forces `.cm-editor { display: flex !important }`, which beats the UA `[hidden] { display: none }`. A scoped `!important` rule with higher specificity wins.

- [ ] **Step 1: Add the override**

In `src/styles.css`, immediately after this block:

```css
#editor .cm-editor {
  height: 100%;
}
```

add:

```css
#editor .cm-editor[hidden] {
  display: none !important;
}
```

Specificity `(1,2,0)` (one ID + one class + one attribute) beats CodeMirror's `.cm-editor` `(0,1,0)`; both `!important`, so specificity decides → our rule applies and inactive editors collapse.

- [ ] **Step 2: Build to confirm no CSS/TS regressions**

Run: `npx tsc --noEmit`
Expected: no errors (CSS isn't type-checked, but confirm TS still clean).

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "fix(editor): override CodeMirror flex so hidden inactive editors hide on tab switch"
```

> Bug 1 is verified visually in the final smoke test (Task 6); there is no DOM test for CSS visibility.

---

## Task 2: Don't mark files dirty on programmatic load (Bug 2)

**Files:**
- Modify: `src/editor.ts`
- Test: `src/__tests__/editor.test.ts` (NEW, jsdom)

**Interfaces:**
- Produces: unchanged public signatures `createEditor(parent, onDocChanged, onCursor, initialWrap)`, `setText(view, text)`, `getText(view)`. Behavior change: `onDocChanged` no longer fires for transactions emitted by `setText`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/editor.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createEditor, getText, setText } from "../editor";

describe("editor dirty handling", () => {
  it("setText (programmatic load) does not fire onDocChanged", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onDocChanged = vi.fn();
    const view = createEditor(parent, onDocChanged, () => {}, true);
    onDocChanged.mockClear(); // ignore any construction-time callbacks
    setText(view, "hello world");
    expect(getText(view)).toBe("hello world");
    expect(onDocChanged).not.toHaveBeenCalled();
    view.destroy();
  });

  it("an un-annotated dispatch (user edit) fires onDocChanged", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const onDocChanged = vi.fn();
    const view = createEditor(parent, onDocChanged, () => {}, true);
    onDocChanged.mockClear();
    view.dispatch({ changes: { from: 0, to: 0, insert: "x" } });
    expect(onDocChanged).toHaveBeenCalledTimes(1);
    view.destroy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/editor.test.ts`
Expected: the first test FAILS — `setText` currently dispatches a plain change, so `onDocChanged` is called once. (Second test already passes.)

- [ ] **Step 3: Implement the annotation guard**

In `src/editor.ts`:

1. Change the state import to include `Annotation`:

```ts
import { Annotation, Compartment, EditorState } from "@codemirror/state";
```

2. Add a module-private annotation just below `const wrapCompartment = new Compartment();`:

```ts
// Marks transactions produced by setText so the dirty listener can ignore them.
const programmatic = Annotation.define<boolean>();
```

3. Replace the listener's dirty line. Find:

```ts
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onDocChanged();
          if (u.selectionSet || u.docChanged) {
```

and replace with:

```ts
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const isProgrammatic = u.transactions.some(
              (tr) => tr.annotation(programmatic) === true,
            );
            if (!isProgrammatic) onDocChanged();
          }
          if (u.selectionSet || u.docChanged) {
```

4. Annotate `setText`. Find:

```ts
export function setText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}
```

and replace with:

```ts
export function setText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: programmatic.of(true),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/editor.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Run the full frontend suite to confirm no regressions**

Run: `npm test`
Expected: all green (existing `document.test.ts` and `session.test.ts` unchanged at this point).

- [ ] **Step 6: Commit**

```bash
git add src/editor.ts src/__tests__/editor.test.ts
git commit -m "fix(editor): keep files clean when loaded programmatically via setText"
```

---

## Task 3: Persist unsaved edits for all dirty tabs (Bug 3a — write path)

**Files:**
- Modify: `src/session.ts` (`toSession`)
- Modify: `src/tabs.ts` (comment only)
- Modify: `src/main.ts` (`persistSessionNow`)
- Modify: `src/__tests__/session.test.ts`

**Interfaces:**
- `toSession(coll)` now sets `entry.text` for every tab where `t.meta.dirty === true` (titled or untitled), reading `t.unsavedText ?? ""`.
- `persistSessionNow()` now sets `t.unsavedText = getText(t.view)` for every dirty tab (titled or untitled).

**Why:** Today only untitled dirty buffers get their text into localStorage; named files are re-read from disk on restore, losing unsaved edits. This task widens the write side so the next task can restore named buffers.

- [ ] **Step 1: Update the tests first (TDD)**

In `src/__tests__/session.test.ts`, REPLACE the test "toSession omits text for clean untitled tabs and for named tabs" (currently the last `it(...)` in the file) with:

```ts
  it("toSession persists text for all dirty tabs (titled or untitled)", () => {
    let coll = newCollection();
    coll = openTab(coll, tab(null, "t1", false));                       // clean untitled
    coll = openTab(coll, tab(null, "t2", true, "untitled-edits"));      // dirty untitled
    coll = openTab(coll, tab("/x.txt", "t3", true, "named-edits"));     // dirty named
    coll = openTab(coll, tab("/y.txt", "t4", false));                   // clean named
    const s = toSession(coll);
    expect(s.entries[0].text).toBeUndefined(); // clean untitled
    expect(s.entries[1].text).toBe("untitled-edits");
    expect(s.entries[2].text).toBe("named-edits"); // NEW: dirty named now persists
    expect(s.entries[3].text).toBeUndefined(); // clean named
  });

  it("round-trips a dirty named buffer with its unsaved text", () => {
    let coll = newCollection();
    coll = openTab(coll, tab("/notes.md", "t1", true, "unsaved markdown"));
    coll = switchTab(coll, "t1");
    const s = toSession(coll);
    const back = parseSession(JSON.stringify(s));
    expect(back).toEqual(s);
    expect(back?.entries[0].path).toBe("/notes.md");
    expect(back?.entries[0].text).toBe("unsaved markdown");
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/__tests__/session.test.ts`
Expected: "toSession persists text for all dirty tabs…" FAILS (dirty named `t3` currently has `text === undefined`) and "round-trips a dirty named buffer…" FAILS.

- [ ] **Step 3: Widen `toSession`**

In `src/session.ts`, replace the body of `toSession` (the `coll.tabs.map` block) — find:

```ts
    // Persist text only for untitled dirty buffers (caller sets unsavedText).
    if (t.meta.path === null && t.meta.dirty) {
      entry.text = t.unsavedText ?? "";
    }
```

and replace with:

```ts
    // Persist text for every dirty buffer (titled or untitled). The caller
    // (persistSessionNow) sets unsavedText from the live editor before calling.
    if (t.meta.dirty) {
      entry.text = t.unsavedText ?? "";
    }
```

- [ ] **Step 4: Update the `SessionEntry.text` doc comment**

In `src/session.ts`, find:

```ts
  /** Present only for untitled dirty buffers being persisted. */
  text?: string;
```

and replace with:

```ts
  /** Present for any dirty buffer (titled or untitled) being persisted. */
  text?: string;
```

- [ ] **Step 5: Update the `TabState.unsavedText` doc comment**

In `src/tabs.ts`, find:

```ts
  /** Present only when persisting a dirty untitled buffer to localStorage. */
  unsavedText?: string;
```

and replace with:

```ts
  /** Present when persisting a dirty buffer (titled or untitled) to localStorage. */
  unsavedText?: string;
```

- [ ] **Step 6: Widen `persistSessionNow`**

In `src/main.ts`, inside `persistSessionNow()` (around lines 236-243), find:

```ts
  // Sync unsavedText on dirty untitled tabs so the snapshot captures their latest content.
  for (const t of runtime) {
    if (t.meta.path === null && t.meta.dirty) {
      t.unsavedText = getText(t.view);
    } else {
      t.unsavedText = undefined;
    }
  }
```

and replace with:

```ts
  // Sync unsavedText on ALL dirty tabs so the snapshot captures their latest content.
  for (const t of runtime) {
    if (t.meta.dirty) {
      t.unsavedText = getText(t.view);
    } else {
      t.unsavedText = undefined;
    }
  }
```

- [ ] **Step 7: Run the full frontend suite**

Run: `npm test`
Expected: all green, including the two new/updated session tests and the existing round-trip + clamp tests.

- [ ] **Step 8: Commit**

```bash
git add src/session.ts src/tabs.ts src/main.ts src/__tests__/session.test.ts
git commit -m "feat(session): persist unsaved edits for named files in localStorage"
```

---

## Task 4: Restore dirty named buffers + true discard on close (Bug 3b — read path)

**Files:**
- Modify: `src/main.ts` (`restoreSessionOrNew`, `onCloseRequested`)

**Interfaces:**
- `restoreSessionOrNew()`: a named session entry that carries `text` is restored as a dirty buffer (text from the blob, not disk); a named entry without `text` is re-read from disk as today.
- `onCloseRequested()`: choosing "discard" sets `t.meta.dirty = false` so the trailing `persistSessionNow()` omits the buffer (no ghost restore).

**Depends on:** Task 3 (write side) and Task 2 (so `createTab(text, {dirty:true})` keeps dirty=true instead of being flipped by the load listener).

- [ ] **Step 1: Restore dirty named buffers in `restoreSessionOrNew`**

In `src/main.ts`, replace the body of the `for (const entry of session.entries)` loop in `restoreSessionOrNew()`. Find:

```ts
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
```

and replace with:

```ts
  for (const entry of session.entries) {
    if (entry.path && entry.text !== undefined) {
      // Dirty named buffer: restore the user's unsaved edits (do NOT re-read disk).
      // Dedup like openPath: a forwarded single-instance file for the same path
      // may arrive during restore; switch to the existing tab instead of duping.
      // ponytail: stale-buffer ceiling — if the file changed on disk since this
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
        dirty: true,
      };
      appendAndActivate(createTab(entry.text ?? "", m));
    }
  }
```

- [ ] **Step 2: Make "Don't Save" a true discard in `onCloseRequested`**

In `src/main.ts`, inside the `for (const t of runtime)` loop of `onCloseRequested()` (around lines 419-426), find:

```ts
    const choice = await askSave(fileName(t.meta));
    if (choice === "cancel") return; // abort shutdown
    if (choice === "save") {
      // doSave targets activeTab(), which we just switched to.
      await doSave();
      if (t.meta.dirty) return; // save was cancelled in Save As
    }
    // "discard" falls through to the next tab
```

and replace with:

```ts
    const choice = await askSave(fileName(t.meta));
    if (choice === "cancel") return; // abort shutdown
    if (choice === "save") {
      // doSave targets activeTab(), which we just switched to.
      await doSave();
      if (t.meta.dirty) return; // save was cancelled in Save As
    } else if (choice === "discard") {
      // True discard: clear dirty so persistSessionNow() below omits this buffer
      // and the file re-reads from disk next launch (no ghost restore).
      t.meta.dirty = false;
    }
```

(`closeTabById` needs no change — on discard the tab is removed from `runtime` before the next `persistSessionNow()`, so it is naturally omitted.)

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors (note `main.ts` already imports `findTabByPath` at the top).

Run: `npm test`
Expected: all green (no new unit tests here — the restore and discard paths live in the DOM/async app layer; they are covered by the manual smoke test in Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(session): restore unsaved named-file buffers on launch and discard on close"
```

---

## Task 5: Backend safety check

**Files:** none modified.

- [ ] **Step 1: Confirm backend is unaffected**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all existing `fs_cmds` inline tests pass (this plan touches no Rust).

> If cargo is unavailable in the environment, skip with a note; the Rust sources are untouched by this plan.

---

## Task 6: Final verification (gate before "done")

- [ ] **Step 1: Clean type-check + full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no TS errors; all vitest tests green.

- [ ] **Step 2: Manual smoke checklist (run `npm run tauri dev`)**

1. **Tab switch shows the right text (Bug 1):** open two `.md` files. Click each tab. The editor text matches the selected file; the preview matches too. Open a third non-`.md` file (`.txt`) and switch between all three — editor updates each time.
2. **No false dirty on open (Bug 2):** open a file and do not edit. The window title has no leading `*`; the tab shows no dirty dot. Repeat for a second file.
3. **Edit still marks dirty:** type in a tab → `*` appears in the title and a dirty dot on the tab. Save (`Ctrl+S`) → clean again.
4. **Discard on close (Bug 3):** edit a named file, then close the window. At the prompt choose "Don't Save." Reopen the app → the file is back to its on-disk content, not your edits (no ghost restore), and is clean.
5. **Hot-exit for named files (Bug 3):** edit a named file. Close the window and choose "Cancel" at the prompt (window stays open), then force-close the window via the taskbar/Os close without another prompt path, OR simply edit and kill the dev process. Reopen → the unsaved edits are restored and the tab is marked dirty.
6. **Untitled regression guard:** type into a fresh (Untitled) tab, restart the app → the untitled buffer and its text are restored and dirty (unchanged behavior).

- [ ] **Step 3: Report**

Report exactly: the three commit hashes landed, `npm test` output summary, `cargo test` status, and which smoke steps passed. If any smoke step fails, do NOT mark done — escalate.

---

## Self-review (completed during planning)

- **Spec coverage:** Bug 1 → Task 1; Bug 2 → Task 2; Bug 3 write path → Task 3, read path + discard → Task 4; backend safety → Task 5; verification → Task 6. All spec §4 items mapped.
- **Placeholders:** none; every code step contains the exact code.
- **Type consistency:** `programmatic` annotation defined in Task 2, referenced only there. `findTabByPath`, `createTab`, `appendAndActivate`, `switchToTab`, `DocMeta`, `askSave` all used with their existing signatures. `toSession`/`persistSessionNow`/`restoreSessionOrNew` changes agree on "dirty ⇒ text persisted and restored."
- **Risk note:** Task 2's jsdom editor test is the only piece that depends on CodeMirror constructing cleanly under jsdom (it does in CM's own test suite). If construction throws in this environment, the executor may fall back to manual verification of Bug 2 and keep the test skipped with a `ponytail:` note — but try the test first.
