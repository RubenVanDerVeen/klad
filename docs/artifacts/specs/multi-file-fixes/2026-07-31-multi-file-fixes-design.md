# Multi-file / dirty-state / close-prompt fixes — Design

**Date:** 2026-07-31
**Status:** Approved (Option A chosen by user)
**Scope:** `src/main.ts`, `src/editor.ts`, `src/session.ts`, `src/tabs.ts`, `src/styles.css`, `src/__tests__/session.test.ts`

## 1. Problem

Three user-reported bugs in the multi-tab editor:

1. **Editor text doesn't update on tab switch.** With multiple files open, the editor always shows the first opened file's text. The Markdown preview pane *does* update correctly on switch. Affects all file types.
2. **False dirty/modified state.** Files that were only opened (never edited) appear modified (dirty asterisk in title, dirty dot on tab).
3. **Close-time save prompt for unchanged files.** Closing the app prompts to save files the user never edited. User expectation: unsaved edits should be remembered across sessions, so unchanged files must not prompt.

## 2. Root causes (investigated, evidence-backed)

### Bug 1 — `hidden` attribute is defeated by CodeMirror's baseTheme
`showOnly()` (`src/main.ts:188-193`) hides inactive editors by setting the HTML `hidden` attribute on each `.cm-editor` DOM node. CodeMirror's baseTheme declares `& { display: flex !important }` (compiled to `.cm-editor`) — an author-origin `!important` rule that beats the UA `[hidden] { display: none }`. Net effect: inactive editors are never hidden. All editors stack vertically inside `#editor` (block container), each `height:100%`; `body { overflow: hidden }` clips everything below the first, so only the first-appended editor is ever visible. Switching tabs updates `meta`, the tab bar, and the preview (which renders into a separate `#preview` node from the active view's text — `applyPreviewMode()` `main.ts:181-186`) but never changes which editor is on screen.

### Bug 2 — programmatic load flips the dirty flag
`createTab()` (`main.ts:124-156`) calls `setText(view, initialText)` (`main.ts:152`), which dispatches a real `changes` transaction (`editor.ts:51-55`). The unguarded `updateListener` (`editor.ts:27-34`) fires `onDocChanged` with `docChanged === true`, and the closure sets `owner.meta.dirty = true` (`main.ts:135-141`). Therefore **every** tab loaded with non-empty content is immediately dirty. (Empty new untitled tabs are the exception: empty→empty dispatch yields an empty `ChangeSet`, `docChanged === false`.) Dirty is a pure explicit flag (`document.ts:5`), no content comparison.

### Bug 3 — downstream of Bug 2, plus a persistence scope gap
The close handlers `onCloseRequested` (`main.ts:413-430`) and `closeTabById` (`main.ts:247-265`) gate the save prompt on `t.meta.dirty`. Because of Bug 2 every opened file is falsely dirty → every file prompts. Separately, session persistence (`session.ts`) stores buffer text **only for untitled dirty tabs** (`toSession` `session.ts:86`, `persistSessionNow` `main.ts:238`). Named files are re-read from disk on restore (`restoreSessionOrNew` `main.ts:478-480`), so unsaved edits to named files do not survive restart. The persistence mechanism itself is sound; only its scope is limited.

## 3. Goals / non-goals

**Goals**
- Switching tabs shows the correct file's text in the editor.
- Opening/reverting/restoring a file does not mark it dirty; only genuine user edits do.
- Unsaved edits to **any** file (titled or untitled) survive an app restart (hot-exit), with no data loss.
- Unchanged files never trigger a save prompt.
- "Don't Save" still means true discard (the edit does not ghost-restore next launch).

**Non-goals (YAGNI)**
- Detecting on-disk changes to a named file whose dirty buffer is being restored (stale-buffer conflict resolution). Single-author app; accepted ceiling.
- A disk-backed session/restore file (current localStorage mechanism is sufficient).
- Removing the close-time save prompt entirely (the user chose Option A, not Option C; the prompt stays as the "save to disk now?" affordance).
- Adding a jsdom DOM-test harness for the CodeMirror layer (out of scope; see §7).

## 4. Design

### 4.1 Bug 1 — make `hidden` work on `.cm-editor` (CSS)
Add one scoped rule to `src/styles.css` (after the existing `#editor .cm-editor { height: 100% }` block):

```css
#editor .cm-editor[hidden] { display: none !important; }
```

Specificity: `#editor .cm-editor[hidden]` = one ID + one class + one attribute = `(1,2,0)`, vs CodeMirror's `.cm-editor` = `(0,1,0)`. Both are `!important`, so specificity decides the tie → our rule wins, regardless of source order (CM injects its theme at runtime). No JS change to `showOnly` needed; the existing `hidden`-attribute mechanism now works.

### 4.2 Bug 2 — tag programmatic loads; skip the dirty-flip
Use a CodeMirror `Annotation` (from the already-installed `@codemirror/state`) to mark transactions produced by `setText`. The `updateListener` skips `onDocChanged` for annotated transactions.

`src/editor.ts`:
```ts
import { Annotation, Compartment, EditorState } from "@codemirror/state";
const programmatic = Annotation.define<boolean>();

// inside the updateListener:
if (u.docChanged) {
  const isProgrammatic = u.transactions.some((tr) => tr.annotation(programmatic) === true);
  if (!isProgrammatic) onDocChanged();
}

export function setText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: programmatic.of(true),
  });
}
```

Effects:
- Open (`openPath`): `createTab(text, {…dirty:false})` → stays clean. ✓
- Restore untitled/named dirty buffer: `createTab(text, {…dirty:true})` → stays dirty (guard only suppresses the *set*, never forces false). ✓
- User typing: not annotated → `onDocChanged` fires → dirty. ✓
- Preview on switch is still driven by `applyPreviewMode()`, independent of this listener. ✓

### 4.3 Bug 3 — hot-exit persistence for all dirty files + true discard

**Persist all dirty buffers.** Two edits:
- `persistSessionNow()` (`main.ts:231-245`): sync `unsavedText` for **every** dirty tab, not only untitled:
  ```ts
  for (const t of runtime) {
    if (t.meta.dirty) t.unsavedText = getText(t.view);
    else t.unsavedText = undefined;
  }
  ```
- `toSession()` (`session.ts:78-95`): include `text` for **every** dirty tab:
  ```ts
  if (t.meta.dirty) entry.text = t.unsavedText ?? "";
  ```
  (Replaces the `t.meta.path === null && t.meta.dirty` condition.)

**Restore dirty named buffers.** In `restoreSessionOrNew()` (`main.ts:471-501`), branch on whether a named entry carries text:
- `entry.path && entry.text !== undefined` → dirty named buffer: `createTab(entry.text, { path: entry.path, encoding, eol, dirty: true })` then `appendAndActivate`. Do **not** re-read from disk — restore the user's unsaved buffer. Dedup still works: a forwarded file open for the same path hits `findTabByPath` and just switches to the restored tab.
- `entry.path && entry.text === undefined` → clean named: `openPath(entry.path)` (re-read from disk), as today.
- Untitled branch unchanged.

**True discard on close.** "Don't Save" must prevent the buffer from ghost-restoring. In `onCloseRequested` (`main.ts:413-430`), set `t.meta.dirty = false` on the discard branch so the final `persistSessionNow()` omits its text:
```ts
if (choice === "discard") t.meta.dirty = false;
// "save" branch unchanged; "cancel" returns early as today
```
(`closeTabById` needs no change — on discard the tab is removed from `runtime` before `persistSessionNow`, so it is naturally omitted.)

**Comment/doc updates:** `tabs.ts` `TabState.unsavedText` and `session.ts` `SessionEntry.text` comments say "untitled"; update to "any dirty buffer (titled or untitled)".

## 5. Approaches considered

**Bug 1 — visibility**
- *(Chosen)* CSS `#editor .cm-editor[hidden] { display:none !important }` — one line, no JS, surgical.
- Toggle `style.display` in `showOnly` — fights CodeMirror's author style, less clean.
- Wrapper `<div>` per editor, hide the wrapper — extra DOM, overkill.
- Global `[hidden] { display:none !important }` — works (preview also relies on `hidden`) but broader than needed; scoped is safer.

**Bug 2 — dirty on load**
- *(Chosen)* CodeMirror `Annotation` on `setText`, listener checks it — idiomatic, no module-level mutable state, covers all call sites uniformly (open/revert/restore).
- Reset `meta.dirty` to intended value after each `setText` call — one-liner per site, but "after the fact" and easy to forget on a new call site.
- Build initial state with `EditorState.create({ doc: initialText })` so the load is not a transaction — eliminates the load transaction entirely, but `setText` is still needed for future revert/restore; two mechanisms. Rejected to keep one uniform mechanism.
- Module-level `suppressDirty` boolean toggled around `dispatch` — works (dispatch is synchronous) but shared mutable state is subtler than the annotation.

**Bug 3 — persistence scope** (user decision)
- *(Chosen — Option A)* Persist unsaved edits for ALL files; keep the save prompt (now accurate); "Don't Save" = discard.
- Option B: fix Bug 2 only; named-file unsaved edits still lost on close. Rejected — does not satisfy "remember unsaved changes."
- Option C: persist all + remove the save prompt entirely. Rejected by user — loses the explicit "save to disk" safety net.

## 6. Edge cases & known ceilings (ponytail)

- **Stale buffer vs disk:** if a named file changes on disk between sessions while a dirty buffer is persisted, the stale buffer is restored (user's unsaved edits win). `ponytail:` comment will name this and the mtime-comparison upgrade path.
- **localStorage quota:** `saveSession` already wraps `setItem` in `try/catch` (best-effort). Large files may silently fail to persist; acceptable for a Notepad-class app. No size cap added (YAGNI).
- **`getText` cost on every debounced save:** negligible for typical file sizes.
- **Annotation import:** `Annotation` is from `@codemirror/state`, already a dependency. No new packages.

## 7. Testing strategy

- **Unit (vitest, `src/__tests__/`):** session layer.
  - Update `session.test.ts` "toSession omits text…" → new contract: `toSession` includes `text` for **all** dirty tabs (titled + untitled), reading `unsavedText`.
  - Add: dirty *named* tab round-trips with `text` intact through `toSession` → `JSON.stringify` → `parseSession`.
  - Add: clean named tab still omits `text`; clean untitled still dropped.
  - Existing round-trip and clamp tests stay green.
- **Manual smoke (bugs 1 & 2 live in the CodeMirror/DOM layer, which has no DOM test harness today):**
  1. Open two `.md` files → switch tabs → editor text matches each file; both previews match.
  2. Open a file, do not edit → no dirty asterisk/dot; title clean.
  3. Edit → dirty; save → clean.
  4. Edit a named file, close app, "Don't Save" → reopen → disk version (no ghost restore).
  5. Edit a named file, close window via taskkill/crash-equivalent (or just close and "Cancel" then close again) → reopen → unsaved edits restored, tab marked dirty.
  6. Untitled buffer dirty → restart → restored dirty (regression guard for existing behavior).
- **Backend:** no Rust changes → `cargo test` unchanged, run for safety.

## 8. Files touched

| File | Change |
|---|---|
| `src/styles.css` | +1 rule: `#editor .cm-editor[hidden] { display: none !important; }` |
| `src/editor.ts` | `Annotation` + gate `onDocChanged` in listener; `setText` annotates |
| `src/session.ts` | `toSession` persists text for all dirty tabs; comment updates |
| `src/tabs.ts` | `unsavedText` comment update only |
| `src/main.ts` | `persistSessionNow` syncs all dirty buffers; `restoreSessionOrNew` restores dirty named buffers; `onCloseRequested` discard → `dirty=false` |
| `src/__tests__/session.test.ts` | Update expectations + new dirty-named round-trip case |

**Catalogs (AGENTS.md "Adding features"):** no new Tauri command, file association, capability, dependency, or dialog markup. `main.rs` / `fileio.ts` / `tauri.conf.json` / `capabilities/default.json` / `index.html` untouched.

## 9. Implementation order (summary — full plan is the companion `-plan.md`)

1. Bug 1 CSS fix (smallest, independent).
2. Bug 2 annotation guard.
3. Bug 3a persist all dirty buffers + tests.
4. Bug 3b restore dirty named buffers + discard semantics + tests.
5. Verification: `npm test`, `cargo test`, manual smoke checklist.
