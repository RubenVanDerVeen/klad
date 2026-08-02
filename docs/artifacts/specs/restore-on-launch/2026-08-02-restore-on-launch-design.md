# Restore Session on File-Arg Launch — Design

- **Date:** 2026-08-02
- **Topic:** `restore-on-launch`
- **Status:** Spec (approved, ready to execute)
- **Scope:** Frontend-only. One branch inversion in `src/main.ts` (the startup IIFE). Plus two doc amendments in previously-shipped specs that documented the old behavior. No Rust, no new modules, no new deps, no catalog additions.
- **Author:** Planner session 2026-08-02
- **Depends on:** already-merged session-restore (`src/session.ts`, `restoreSessionOrNew` in `src/main.ts`), single-instance (`tauri-plugin-single-instance`), and hot-exit (2026-08-01).
- **Supersedes:** the "skip restore on CLI file arg" rule in `docs/artifacts/specs/tabs/2026-07-18-tabs-and-session-restore-design.md` §8 (lines 336-349) and the implicit reaffirmation in `docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md` §5 (line 101).

## 1. Problem

User intent (verbatim):

> When klad isn't opened, and I open a file by double clicking, it doesn't open with all the unsaved untitled files, or with previously opened files. I want to be able to double click a file and it opens just as if I were to open klad by itself and open the double clicked file next to the other files.

Concretely: when the OS launches klad with a double-clicked file as `argv[1]` (klad **not** already running), klad opens **only** that file and discards the saved session — unsaved untitled notes and previously-opened files from the last session do not come back. The user expects the double-clicked file to land **alongside** the restored session, exactly as if they had launched klad bare and then opened the file.

When klad **is** already running, the single-instance plugin forwards the path to the existing instance and the file opens as a new tab next to whatever is already there — this case already behaves the way the user wants. **Only the cold-start case is wrong.**

## 2. Root cause (trace, not guesswork)

`src/main.ts:446-460` (the startup IIFE):

```ts
void (async () => {
  void listenOpenFile((p) => void openPath(p));
  const startupFile = await getStartupFile();
  if (startupFile) {
    // CLI file arg wins; skip session restore (see spec §8 multi-instance rule).
    await openPath(startupFile);
  } else {
    await restoreSessionOrNew();
  }
})();
```

The `if (startupFile)` branch skips `restoreSessionOrNew()` whenever a file arg is present. So a cold-start with `argv[1] = foo.txt` opens only `foo.txt` — the entire saved session is ignored for that launch.

The rule was authored in the tabs spec §8 (2026-07-18) and intentionally preserved when hot-exit landed (2026-08-01). It was defensive against the "double-click file A → get A plus the saved session B/C/D surprise" when **multi-instance** was still the model: back then each OS-launched instance had its own localStorage view and last-writer-wins semantics, so restoring on every launch could surprise users with tabs they didn't ask for.

**Two things have changed since the rule was written, both removing the original justification:**

1. **Single-instance mode shipped** (`docs/artifacts/specs/single-instance/2026-07-18-single-instance-design.md`). There is now exactly one long-lived instance. A second OS launch is forwarded to the first via the `single-instance` event and the second process exits. The "multiple instances with divergent localStorage" scenario the rule protected against no longer exists.
2. **Hot-exit shipped** (2026-08-01). Window close now silently stashes **every** dirty buffer (titled + untitled) to localStorage. So the skip-restore branch now throws away strictly more user work than it did when the rule was written — including unsaved untitled notes that the user explicitly expects to get back.

The "surprise" the rule was avoiding is no longer the dominant concern. Losing the user's unsaved work from the previous session is.

## 3. Key realization — everything else already handles the combination

Inverting the branch is safe because every adjacent subsystem already does the right thing for "restore **and** open the startup file":

- **`restoreSessionOrNew()`** (`main.ts:462-510`) is independent of `getStartupFile()`. Calling it unconditionally changes nothing about its internals.
- **Dedup covers the collision case for free.** If the saved session already contains the double-clicked file:
  - **Clean** in session → restore re-reads it from disk via `openPath(entry.path)` (`main.ts:489`); the subsequent `openPath(startupFile)` hits `findTabByPath(coll, path)` (`main.ts:293-297`) and just switches to the existing tab. No double-read, no duplicate.
  - **Dirty** in session (hot-exit stashed edits) → restore recreates it dirty from `entry.text` (`main.ts:469-486`); the subsequent `openPath(startupFile)` dedups to it. The user's unsaved edits win and are not lost.
- **Untitled tabs cannot collide** (`path === null`, `findTabByPath` never matches — `tabs.ts:52-54`), so restored untitled notes never get deduped away.
- **The single-instance listener stays correct.** It is registered before the first `await` (`main.ts:451`), so a forwarded file arriving mid-restore still lands via `openPath` and dedups against whatever restore has built so far. The comment at `main.ts:447-451` already documents this interleaving as safe.
- **`appendAndActivate` always activates the last tab it touches**, so opening the startup file last makes it the active tab — which is the desired UX (you double-clicked foo.txt, you want to be looking at foo.txt).

## 4. Goals and non-goals

### Goals
- Cold-starting klad via a double-clicked file (OS passes the path as `argv[1]`, klad not already running) **restores the saved session** (dirty named buffers, clean named files re-read from disk, dirty untitled notes) **and then opens the double-clicked file** as a new (or deduped-to-existing) tab, activated.
- Behavior is identical whether klad was already running (forward path, unchanged) or not (cold start, fixed): the file lands alongside whatever else is open.

### Non-goals (YAGNI for this change)
- **Multi-file argv.** `get_startup_file` still returns only `argv[1]` (`fs_cmds.rs:112-117`). Opening multiple files from one OS launch (e.g. selecting several in Explorer and pressing Enter) remains a future concern, unchanged. Single-instance spec §2 line 29 already declares this YAGNI.
- **mtime / external-change detection on restore.** Pre-existing ceiling; the dirty buffer wins. Unchanged (ponytail comment at `main.ts:473-474`).
- **A setting toggle.** The new behavior is simply correct for the stated intent; no configurability.
- **Touching the second-launch (forward) path.** It already does the right thing. No change to `tauri-plugin-single-instance`, `main.rs:22-29`, `fileio.ts:35-56`, or the `listenOpenFile` wiring.

## 5. The change

Replace the branch in `src/main.ts:453-459` so that session restore always runs, and the startup file (if any) opens afterward:

```ts
  const startupFile = await getStartupFile();
  // Always restore the saved session (untitled notes + previously opened files),
  // then open the OS-provided startup file alongside it. openPath dedups by path,
  // so if the startup file is already in the session it just switches to it.
  await restoreSessionOrNew();
  if (startupFile) {
    await openPath(startupFile);
  }
```

That is the entire code change. The new comment replaces the old "CLI file arg wins; skip session restore" comment, which described the behavior being removed.

### Why this is safe (no data-loss regression)
- The saved session is **restored**, not discarded. The user loses nothing they had before.
- The startup file is **opened in addition**, never instead of. `openPath` is additive (pushes a tab) or neutral (dedups to existing). It never closes or overwrites a restored tab.
- The hot-exit invariant (disk is never written on close; dirty buffers come back dirty) is untouched — restore semantics are not on this branch's path.
- The forward (second-launch) path is untouched — no behavior change for the already-running case.

## 6. Behavior matrix (after the change)

| Launch | Saved session? | Startup file arg? | Tabs after startup | Active tab |
|---|---|---|---|---|
| Cold, no file (e.g. Start menu) | yes | no | restored session, else 1 fresh Untitled | saved activeIndex (clamped) |
| Cold, double-clicked file | yes | yes | restored session + startup file (deduped if already present) | **startup file** |
| Cold, no session, double-clicked file | no | yes | 1 fresh Untitled + startup file | startup file |
| Cold, double-clicked file already in session (clean) | yes | yes (same path) | restored session; startup file deduped to its restored tab | startup file's tab |
| Cold, double-clicked file already in session (dirty, hot-exit stashed) | yes | yes (same path) | restored session with the dirty buffer intact; startup file deduped to it | startup file's tab (dirty, edits preserved) |
| Already running, double-clicked file (forward path) | n/a — session is live | forwarded via event | existing live tabs + forwarded file (deduped) | forwarded file |

Row 4 and 5 are the collision cases; dedup makes them correct for free (see §3).

Note on row 3 ("no session, double-clicked file"): the user gets `Untitled + foo.txt`. This matches the literal request — "as if I were to open klad by itself [→ 1 Untitled] and open the double clicked file next to the other files [→ Untitled + foo.txt]." If users find the spare Untitled noisy in practice, a future tightening can skip the fresh-Untitled creation when a startup file is present; **not built now** (YAGNI — wait for the complaint).

## 7. Testing strategy

### Why no new automated unit test
The changed code is the startup IIFE in `main.ts`, which awaits Tauri IPC (`getStartupFile`) and mutates live `EditorView`s via `openPath` / `restoreSessionOrNew`. Per the project's established convention (tabs spec §12: "Pure-logic tests only. No Tauri IPC mocking, no CodeMirror mocking."), `main.ts` integration behavior is **not** unit-tested. The pure logic this branch depends on — `toSession` round-trips, `findTabByPath` dedup, `parseSession` clamping — is already covered by `src/__tests__/session.test.ts` (10 tests) and `src/__tests__/tabs.test.ts`. The bug was never in that logic.

The appropriate verification bar is the manual smoke test below + the existing automated suite staying green.

### Existing automated suite (must stay green, unchanged)
- `npm test` — frontend vitest suite.
- `npx tsc --noEmit` — typecheck clean.
- `cargo test --manifest-path src-tauri/Cargo.toml` — backend tests (no Rust change; confirm no regression).

### Manual smoke test (acceptance — the real "failing test" for this bug)
Prep: clear `localStorage["klad-session"]` in devtools, then build the session to restore.

1. **Untitled + file (the headline case):** `Ctrl+N` → type "note A" → close window (hot-exit stashes). Now in Explorer/Finder, double-click a real `foo.txt`. Klad cold-starts → tabs are `[Untitled(dirty, "note A"), foo.txt]`, **foo.txt active**. ✅
2. **Previously opened file + new file:** Open `a.txt`, open `b.txt`, close window. Double-click `c.txt` in Explorer. Tabs: `[a.txt, b.txt, c.txt]`, c.txt active. ✅
3. **Dirty named buffer preserved across a file launch:** Open `a.txt`, type "edited", close window (hot-exit stashes the dirty buffer). Double-click `a.txt` in Explorer. Tabs: `[a.txt(dirty, contains "edited")]`, a.txt active. **Disk unchanged** (verify mtime / `Get-Content`). ✅ — this is the collision-dirty case; dedup must not lose the stashed edits or re-read disk.
4. **Clean collision dedups:** Open `a.txt`, make no edits, close. Double-click `a.txt`. Tabs: `[a.txt]` (one tab, not two), a.txt active. ✅
5. **No-session cold start still works (regression guard):** Clear localStorage, launch klad from Start menu (no file arg). One fresh Untitled tab. ✅
6. **Already-running forward path unchanged (regression guard):** Launch klad bare, open a file, then double-click another file in Explorer. Second file opens as a new tab next to the first; no new instance spawns. ✅
7. **Linux smoke:** same as 1-2 from a `.desktop` launch with `%f`/`%u` placeholders, on the deb/appimage build. Confirms `get_startup_file`'s `argv[1]` reads correctly under each DE's quoting.

## 8. Doc amendments (previously-shipped specs that documented the old rule)

Two existing specs describe the behavior being changed. They must be amended in the same change so the docs don't contradict the code (AGENTS.md: "Two catalogs disagree about the same item" is a red flag; specs are the behavioral catalog).

### `docs/artifacts/specs/tabs/2026-07-18-tabs-and-session-restore-design.md` §8 (lines 336-349)
Replace the "Multi-instance (non-goal, but documented behavior)" subsection with a pointer to this spec and a one-line note that single-instance + hot-exit made the old skip-restore rule obsolete. Keep the heading so old links anchor.

### `docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md` §5 (line 101)
The sentence "Nothing else in `main.ts`, `session.ts`, `tabs.ts`, or the restore path changes." was accurate at authoring time. Add a one-line forward-reference noting that the separate restore-on-launch spec (this doc) later reopened the startup branch.

Both amendments are documentation-only; no code in those specs changes.

## 9. Known limitations / future ceilings

- **The spare Untitled on no-session cold start (row 3 of §6).** Documented above as a deliberate YAGNI. Upgrade path: in `restoreSessionOrNew`, accept a hint that a startup file is pending and skip the fresh-Untitled creation. Not built unless requested.
- **Multi-file argv.** `get_startup_file` returns only `argv[1]`. If the user selects N files in Explorer and presses Enter, only the first opens (rest of argv ignored). Pre-existing YAGNI per single-instance spec §2 line 29; unchanged here.
- **Stale buffer vs disk on restore.** Pre-existing ceiling (`main.ts:473-474` ponytail comment). Unchanged.
- **Linux `file://` URIs.** `get_startup_file` uses `std::env::args().nth(1).filter(is_file)`; some DEs pass `file://` URIs via `%u` in the `.desktop` `Exec` line, which would fail `is_file()` and fall through to restore-only (no startup file). Manual smoke step 7 surfaces this if it bites; fix would be URI stripping in `get_startup_file`. Not built preemptively.

## 10. Catalog updates (per AGENTS.md)

| Catalog | Touched? | Change |
|---|---|---|
| `src-tauri/src/main.rs` `invoke_handler![]` | No | No new commands. |
| `src/fileio.ts` | No | Wrappers reused (`getStartupFile`, `listenOpenFile`, `openPath`). |
| `src-tauri/tauri.conf.json` `fileAssociations` | No | No new file types. |
| `src-tauri/capabilities/default.json` | No | No new permissions. |
| `package.json` / `Cargo.toml` deps | No | No new deps. |
| `index.html` | No | No dialog markup change. |
| `src/menu.ts` | No | No menu change. |

Files actually modified: `src/main.ts` (1 branch), `docs/artifacts/specs/tabs/2026-07-18-tabs-and-session-restore-design.md` (§8 amendment), `docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md` (§5 forward-reference). No red flags: no new Tauri command, no two catalogs disagree.

## 11. Resolved decisions

| Decision | Resolution |
|---|---|
| Startup branch behavior | Always restore, then open startup file if present. |
| Scope of code change | The 7-line `if/else` block at `src/main.ts:453-459`. |
| Active tab after cold-start with file | The startup file (opened last → activated by `appendAndActivate`). |
| Collision with dirty buffer in session | Dedup; stashed edits win, disk untouched. |
| Spare Untitled on no-session cold start | Kept (YAGNI); document the future tightening. |
| New automated tests | None (integration handler; pure logic already covered). Verify via manual smoke + existing suite. |
| Doc amendments | Yes — tabs §8 and hot-exit §5 must not contradict the new code. |
| Multi-file argv | Out of scope; unchanged YAGNI. |

## 12. Open issues

None.
