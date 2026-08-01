# Hot Exit on Window Close — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make closing the klad window silently stash every dirty buffer to `localStorage["klad-session"]` (instead of showing a save prompt that clears `dirty` and defeats the stash), so unsaved untitled notes and unsaved edits to existing files survive close/reopen — stashed inside Klad, never written to disk.

**Architecture:** Single-file, single-function change. Replace the body of the `onCloseRequested` handler in `src/main.ts` with a hot-exit stash (`persistSessionNow()` then `appWindow.destroy()`). The persistence layer (`src/session.ts` → `toSession`/`saveSession`) and the restore path (`restoreSessionOrNew`) are already correct and unchanged. Per-tab close (`closeTabById`) keeps the classic save prompt.

**Tech Stack:** TypeScript, Tauri 2 (`@tauri-apps/api/window`), CodeMirror 6, vitest, cargo. Frontend-only.

**Spec:** `docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md` (read this first — it contains the root-cause trace and the exact before/after code).

## Global Constraints

- **OS:** Windows + Linux. Editor buffer is always LF-normalized (CRLF is a save-time concern). (AGENTS.md)
- **Encoding labels** (`"UTF-8"`, `"UTF-8 BOM"`, etc.) are a cross-process contract — do not touch. (AGENTS.md)
- **Test convention:** pure-logic tests only in `src/__tests__/` (no Tauri IPC mocking, no CodeMirror mocking). `main.ts` integration behavior is verified by manual smoke test + the existing automated suite staying green, not by a new unit test. (tabs spec §12, hot-exit spec §7)
- **Verify before claiming done:** run `npm test`, `npx tsc --noEmit`, `cargo test --manifest-path src-tauri/Cargo.toml`; all must pass. (AGENTS.md)
- **No commit/push without the plan carve-out:** this plan is approved spec/plan-driven work, so commit at the task boundary per AGENTS.md's carve-out. Branch from latest `main`.
- **Catalog rule (AGENTS.md):** this change touches only `src/main.ts` — no new Tauri command, no `fileio.ts` wrapper, no `tauri.conf.json`/`capabilities`/deps/`index.html` change. If the implementer finds they need to touch any catalog, stop and re-check.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/main.ts` | App lifecycle, tab orchestration, close handler | **Modify** the `onCloseRequested` handler body (currently lines ~413-433). Replace the dirty-walk + `askSave` prompt loop with a hot-exit `persistSessionNow()` + `appWindow.destroy()`. Add an explanatory comment. |

No other files change. In particular: `src/session.ts`, `src/tabs.ts`, `src/document.ts`, `src/editor.ts`, `src/dialogs.ts`, `src/menu.ts`, `index.html`, and the entire `src-tauri/` tree are **untouched**.

---

## Task 1: Hot-exit on window close

**Files:**
- Modify: `src/main.ts` — the `appWindow.onCloseRequested(...)` handler (search for `onCloseRequested`; currently around lines 413-433).

**Interfaces:**
- Consumes (already defined, unchanged): `persistSessionNow()` (`src/main.ts:231-245`) — clears the debounce timer, syncs `unsavedText = getText(view)` for every dirty tab, calls `saveSession(toSession(coll))`. `appWindow.destroy()` (`@tauri-apps/api/window`) — tears down the window. `event.preventDefault()` — keeps the window alive across the async handler until we call `destroy()`.
- Produces: nothing new. Later code is unchanged; this only changes the close-time behavior of an existing handler.

**Context for the implementer (read the spec, but the essential trace):** The current handler walks every dirty tab and calls `askSave()` (Save / Discard / Cancel). `Save` calls `doSave()` which writes to disk and sets `meta.dirty = false`; `Discard` sets `t.meta.dirty = false`; `Cancel` returns early. The final `persistSessionNow()` then runs, but `toSession` (`src/session.ts:87`) only persists `text` `if (t.meta.dirty)` — so after the prompt, no dirty buffer is ever stashed with its text. That is the bug. The fix is to remove the prompt from window close so dirty buffers reach `persistSessionNow` intact. Restore (`restoreSessionOrNew`, `src/main.ts:474-521`) already restores dirty named buffers (edits, no disk re-read) and dirty untitled buffers — no change needed there.

- [ ] **Step 1: Read the current handler to confirm exact text and line numbers**

Run: open `src/main.ts` and locate `void appWindow.onCloseRequested(async (event) => {`.
Confirm the body matches the spec's "current" block (dirty-walk + `askSave` loop + `persistSessionNow()` + `await appWindow.destroy()`). Note the exact line range for the edit.

- [ ] **Step 2: Replace the handler body with the hot-exit implementation**

Replace the entire `void appWindow.onCloseRequested(async (event) => { ... });` block with exactly:

```ts
void appWindow.onCloseRequested(async (event) => {
  event.preventDefault();
  // Hot exit: silently stash every dirty buffer to localStorage and close.
  // Edits are restored dirty on next launch (restoreSessionOrNew), so the user
  // can save or discard then. Disk is never written here — save_file runs only
  // on explicit Save/Save As. Per-tab close (closeTabById) still prompts.
  persistSessionNow();
  await appWindow.destroy();
});
```

Leave everything else in `src/main.ts` untouched — especially `closeTabById` (which keeps its `askSave` prompt), `persistSessionNow`, `scheduleSessionSave`, `restoreSessionOrNew`, and the `askSave` import (still used by `closeTabById`; do **not** remove the import).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0, no output (no type errors). If `askSave` is flagged as unused, you accidentally removed its only remaining call site (`closeTabById`) — undo that.

- [ ] **Step 4: Run the existing frontend test suite (must stay green, unchanged)**

Run: `npm test`
Expected: 8 test files, **48 tests passed**, 0 failed. The 10 `session.test.ts` tests (including "toSession persists text for all dirty tabs" and the dirty-named-buffer round-trip) must all pass — they cover the persistence contract this change relies on. No new tests are added (see spec §7: the changed code is an imperative UI handler; pure logic is already covered).

- [ ] **Step 5: Run the backend test suite (no Rust change; regression guard)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: `test result: ok. 12 passed; 0 failed`.

- [ ] **Step 6: Manual smoke test (the real acceptance test for this bug)**

Build/run the app: `npm run tauri dev`. Once the window is open, open devtools (or use the app's own runs) and clear the session key: in the webview console, `localStorage.removeItem("klad-session")`. Then:

1. **Untitled hot-exit:** `Ctrl+N` → type `hello untitled` → close the window (click X or Alt+F4) → relaunch (`npm run tauri dev` again) → **expect:** an untitled tab is present, marked dirty, containing `hello untitled`.
2. **Named-file hot-exit, disk untouched:** Open a real `.txt` file (e.g. create `C:\Users\ruben\AppData\Local\Temp\opencode\smoke.txt` with content `original` first) → append ` EDITED` in the editor → close the window → relaunch → **expect:** the file's tab is present, marked dirty, buffer reads `original EDITED`. Then open `smoke.txt` in another editor (or `Get-Content smoke.txt`) → **expect:** it still reads `original` (disk **not** written).
3. **Clean named re-reads disk:** Open `smoke.txt`, make no edits → close → relaunch → **expect:** tab present, not dirty, shows current disk contents.
4. **Active tab restored:** Open 3 tabs, switch to the 2nd → close → relaunch → **expect:** 2nd tab is active.
5. **Per-tab prompt preserved (regression guard):** Open a file, edit it, press `Ctrl+W` → **expect:** the "Do you want to save changes to …?" dialog appears with Save / Discard / Cancel. (This confirms we did not accidentally kill the per-tab prompt.)
6. **No prompt on window close:** With a dirty buffer, close the window (X) → **expect:** no dialog appears; the window closes immediately and stashes.

All six must pass. If any fails, do **not** commit — re-read spec §2 (root cause) and §5 (the change), confirm the edit matches Step 2 exactly, and confirm `closeTabById` was not touched.

- [ ] **Step 7: Commit on the feature branch**

Ensure you are on a branch cut from latest `main` (e.g. `feat/hot-exit`). Stage only `src/main.ts` (and the spec/plan docs if not already committed):

```bash
git add src/main.ts
git status   # confirm ONLY intended files staged
git commit -m "feat(session): hot-exit on window close so dirty buffers survive

Replace the window-close save-prompt loop with a silent stash: persistSessionNow()
captures every dirty buffer's live text to localStorage, then the window destroys.
Disk is never written on close. The prompt cleared dirty before the stash, which
made session restore unreachable through normal close. Restore logic was already
correct and is unchanged. Per-tab close (Ctrl+W) keeps the classic save prompt."
```

(Do not push unless the user asks. AGENTS.md: default is no push without explicit instruction.)

---

## Self-Review (run after writing, before dispatch)

- [x] **Spec coverage:** Spec §5 (the change) → Task 1 Step 2. Spec §7 (testing) → Steps 3-6. Spec §9 (catalogs) → Global Constraints + the "untouched files" note. Spec §4 non-goals (per-tab prompt unchanged, crash-safety out of scope) → enforced by Step 2's "leave `closeTabById` untouched" and the absence of any `onDocChanged`/debounce task. All spec sections mapped.
- [x] **Placeholder scan:** no TBD/TODO/"add error handling"/"similar to". Step 2 contains the exact replacement code. Steps 3-5 contain exact commands and expected output. Step 6 contains exact repro steps with concrete file paths and expected observations.
- [x] **Type consistency:** No new types or functions introduced. `persistSessionNow()` and `appWindow.destroy()` are existing signatures, called unchanged.
