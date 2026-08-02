# Hot Exit on Window Close — Design

- **Date:** 2026-08-01
- **Topic:** `hot-exit`
- **Status:** Spec (approved, ready to execute)
- **Scope:** Frontend-only. One function body change in `src/main.ts`. No Rust, no new modules, no new deps, no catalog additions.
- **Author:** Planner session 2026-08-01
- **Depends on:** already-merged session-restore work (`src/session.ts`, `restoreSessionOrNew` in `src/main.ts`, commits `2feaa25`, `986f8ca`, `f9cbc98`).

## 1. Problem

The session-restore feature is correctly built but **unreachable through the normal close flow**, so users report it "doesn't work."

User intent (both halves):
1. Write in an untitled note → close the app → reopen → the note is back (stashed inside Klad, **not** on disk).
2. Edit an existing file → close the app → reopen → edits are back, file on disk untouched, user can then save or discard.

## 2. Root cause (trace, not guesswork)

The window-close handler walks every dirty tab and shows the classic "Do you want to save changes?" prompt (`Save` / `Discard` / `Cancel`). Every branch that reaches the final stash **clears `dirty` first**:

`src/main.ts:413-433` (current):
```ts
void appWindow.onCloseRequested(async (event) => {
  event.preventDefault();
  for (const t of runtime) {
    if (!t.meta.dirty) continue;
    if (coll.activeId !== t.id) switchToTab(t.id);
    const choice = await askSave(fileName(t.meta));
    if (choice === "cancel") return;            // abort; stash never runs
    if (choice === "save") {
      await doSave();                            // writes to DISK
      if (t.meta.dirty) return;                  // doSave cleared dirty
    } else if (choice === "discard") {
      t.meta.dirty = false;                      // cleared explicitly
    }
  }
  persistSessionNow();                           // only persists tabs STILL dirty
  await appWindow.destroy();
});
```

`src/session.ts:87` — `toSession` only writes `entry.text` `if (t.meta.dirty)`.

**Therefore no dirty buffer that passes through the prompt is ever persisted with its text.** For the user's two scenarios:

| Action | User wants | Gets today |
|---|---|---|
| Edit existing file → close | edits stashed in Klad, disk untouched, reopen shows edits | `Save` writes to disk (unwanted); `Discard` loses edits; `Cancel` won't close. **No option matches intent.** |
| Write untitled note → close | note stashed in Klad, reopen shows it | Same three dead-end choices. |

**Why the 48 unit tests pass anyway:** `src/__tests__/session.test.ts` exercises `toSession` / `parseSession` / `persistSessionNow` as **pure logic in isolation**. No test drives the integrated close loop where the prompt clears `dirty` immediately before the stash. Standard unit/integration blind spot.

## 3. Key realization — restore already works

The restore side already does exactly the right thing for the user's intent; it was never the bug:

`src/main.ts:474-521` (`restoreSessionOrNew`):
- Dirty **named** buffer (`entry.path && entry.text !== undefined`) → restored with the user's edits, `dirty: true`, **does not re-read disk** (`main.ts:481-498`). User can save or discard next session.
- Dirty **untitled** buffer → restored with `entry.text`, `dirty: true` (`main.ts:502-511`).
- Clean named file → re-read from disk (picks up external edits).
- Clean untitled → dropped (never persisted by `toSession`).

So if dirty buffers ever **reach** `persistSessionNow` with `dirty` still set, the entire feature works end-to-end as specified. The close prompt is the single broken link.

## 4. Goals and non-goals

### Goals
- Closing the app window (X / Alt+F4 / File → Exit) **silently stashes** every dirty buffer (titled or untitled) to `localStorage["klad-session"]` and closes. No prompt.
- Reopening restores those buffers dirty, with their text, ready to save or discard — already implemented, no change.
- Disk is **never** written on window close. `save_file` runs only on explicit Save / Save As.

### Non-goals (YAGNI for this change)
- **Per-tab close keeps the prompt.** Closing a single tab via `Ctrl+W` / tab `×` (`closeTabById`, `main.ts:247-286`) is a deliberate "I'm done with this" gesture and keeps the classic-Notepad safety prompt. This preserves klad's stated persona (classic-Notepad users) where it belongs. **No change to `closeTabById`.**
- **Crash / `taskkill /F` / power-loss mid-typing.** Out of scope here. Graceful close is fully covered by this change (the close-time `persistSessionNow` reads live `getText(view)` for every dirty tab regardless of debounce). The crash path still relies on the last structural-op debounce (`scheduleSessionSave` is not wired to `onDocChanged`). One-line upgrade path documented in §8 as a future ceiling; not built now.
- **A "hot exit" setting toggle.** Not adding configurability; the behavior is simply correct for the stated intent.
- **localStorage quota handling.** `saveSession` remains best-effort try/catch. Out of scope; documented ceiling.
- **mtime / external-change detection on restore.** Pre-existing ceiling; unchanged.

## 5. The change

Replace the body of the `onCloseRequested` handler in `src/main.ts` (currently lines 413-433) with a hot-exit stash:

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

That is the entire code change. `persistSessionNow` (`main.ts:231-245`) already:
- clears any pending debounce timer,
- syncs `unsavedText = getText(view)` for **every** dirty tab (titled + untitled),
- calls `saveSession(toSession(coll))`, which writes `text` for every dirty entry.

Nothing else in `main.ts`, `session.ts`, `tabs.ts`, or the restore path changes at authoring time. **Note added 2026-08-02:** the separate `docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md` later reopened the startup IIFE branch in `main.ts` to make session restore run even when klad is launched with a file argument — so dirty buffers stashed by this hot-exit change are no longer discarded on a cold double-click launch. That change is independent of the close-time behavior specified here.

### Why this is safe (no data-loss regression)
- Dirty buffers are **stashed, not discarded.** The user loses nothing on close; they get a dirty restored tab next launch.
- The only "lost" affordance is the prompt's `Cancel` (abort close). With hot-exit there is nothing to abort — nothing is at risk. An accidental X click reopens to the exact same state.
- Disk-write safety is **strengthened**, not weakened: today a careless `Save` click on close writes edits to disk; after this change, window close never writes to disk.

## 6. Behavior matrix (after the change)

| Exit type | Prompt? | Disk written? | Buffer stashed? | Reopen shows |
|---|---|---|---|---|
| Window close (X / Alt+F4 / Exit) | No | No | Yes (all dirty) | Dirty tabs, edits intact |
| Per-tab close (`Ctrl+W` / `×`) on dirty tab | **Yes** (unchanged) | Only if user picks Save | Discard omits it; Save writes disk; Cancel aborts | Per choice |
| Per-tab close on clean tab | No | No | Tab removed | Tab gone |
| Crash / kill / power loss | n/a | No | Only if a prior structural op debounced | Last debounced snapshot (pre-existing ceiling) |

## 7. Testing strategy

### Why no new automated unit test
The changed code is a 3-line imperative UI handler that touches `appWindow` (`@tauri-apps/api/window`) and `runtime` (live `EditorView`s). Per the project's established convention (tabs spec §12: "Pure-logic tests only. No Tauri IPC mocking, no CodeMirror mocking."), `main.ts` integration behavior is **not** unit-tested. The pure logic this handler depends on — `toSession` persists text for all dirty tabs — is **already covered** by `src/__tests__/session.test.ts:68` ("toSession persists text for all dirty tabs (titled or untitled)") and `:81` (dirty named buffer round-trip). The bug was never in that logic.

The appropriate verification bar for this change is the manual smoke test below + the existing automated suite staying green.

### Existing automated suite (must stay green, unchanged)
- `npm test` — 48 frontend tests (incl. 10 in `session.test.ts`).
- `npx tsc --noEmit` — typecheck clean.
- `cargo test --manifest-path src-tauri/Cargo.toml` — 12 backend tests (no Rust change; confirm no regression).

### Manual smoke test (acceptance — the real "failing test" for this bug)
Prep: clear `localStorage["klad-session"]` in devtools, then:

1. **Untitled hot-exit:** `Ctrl+N` → type "hello untitled" → close window (X) → reopen → untitled tab present, dirty, text "hello untitled". ✅
2. **Named-file hot-exit:** Open a real `.txt` → type "edited" → close window (X) → reopen → tab present, dirty, text contains "edited", **file on disk unchanged** (verify by opening the file in another editor / `Get-Content`). ✅
3. **Clean named re-reads disk:** Open a real `.txt`, make no edits → close → reopen → tab present, not dirty, reflects current disk contents. ✅
4. **Active tab restored:** With 3 tabs, switch to the 2nd → close → reopen → 2nd tab is active. ✅
5. **Per-tab prompt preserved (regression guard):** Open a file, edit, press `Ctrl+W` → the "Do you want to save changes?" prompt appears (Save / Discard / Cancel). ✅
6. **Disk never written on window close:** Repeat scenario 2; `git status` (if file is in a repo) or filesystem mtime shows the file was **not** modified by the close. ✅

## 8. Known limitations / future ceilings

- **Crash mid-typing loses edits since the last structural op.** `onDocChanged` (`main.ts:133-145`) sets `dirty` but does not call `scheduleSessionSave()`, so only switch/open/close/save-as schedule a debounce. Graceful close is fully covered (close-time flush reads live text). One-line future upgrade: add `scheduleSessionSave()` to `onDocChanged` for ≤250ms write cadence while typing (soft-crash safety); hard kills still need a Rust-side `RunEvent::ExitRequested` flush. Out of scope here.
- **localStorage quota.** `saveSession` swallows failures (`session.ts:69-76`); a multi-MB buffer could silently fail to stash on close. Pre-existing ceiling.
- **Stale buffer vs disk.** Dirty named buffer wins on restore; no mtime check. Pre-existing ceiling (`main.ts:485` ponytail comment).

## 9. Catalog updates (per AGENTS.md)

| Catalog | Touched? | Change |
|---|---|---|
| `src-tauri/src/main.rs` `invoke_handler![]` | No | No new commands. |
| `src/fileio.ts` | No | Wrappers reused. |
| `src-tauri/tauri.conf.json` `fileAssociations` | No | No new file types. |
| `src-tauri/capabilities/default.json` | No | No new permissions. |
| `package.json` / `Cargo.toml` deps | No | No new deps. |
| `index.html` | No | No dialog markup change (the save prompt stays; it's just not invoked from window close). |
| `src/menu.ts` | No | No menu change. |

Only `src/main.ts` is modified. No red flags: no new Tauri command, no two catalogs disagree.

## 10. Resolved decisions

| Decision | Resolution |
|---|---|
| Window close behavior | Hot-exit: stash all dirty buffers silently, no prompt, never write disk. |
| Per-tab close behavior | Unchanged — keep the classic save prompt (persona safety). |
| Scope of code change | The `onCloseRequested` handler body only. |
| New automated tests | None (integration handler; pure logic already covered). Verify via manual smoke + existing suite. |
| Crash-safety (typing debounce) | Out of scope; documented as a future one-line upgrade. |
| Setting toggle | Not added (YAGNI). |

## 11. Open issues

None.
