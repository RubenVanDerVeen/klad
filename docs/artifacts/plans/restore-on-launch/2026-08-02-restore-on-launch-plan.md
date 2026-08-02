# Restore Session on File-Arg Launch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the OS launches klad with a double-clicked file as `argv[1]` (klad not already running), restore the saved session (unsaved untitled notes + previously opened files) **and then** open the double-clicked file alongside it — instead of skipping restore and opening only that file.

**Architecture:** Single-branch inversion in `src/main.ts`'s startup IIFE: always call `restoreSessionOrNew()`, then `openPath(startupFile)` only if a startup file is present. The dedup (`findTabByPath`), single-instance event forwarding, and hot-exit stash are already correct for the combination — no other subsystem changes. Two previously-shipped specs (tabs §8, hot-exit §5) documented the old skip-restore rule and must be amended so docs don't contradict code.

**Tech Stack:** TypeScript, Tauri 2 (`@tauri-apps/api`), vitest, cargo. Frontend-only.

**Spec:** `docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md` (read this first — it contains the root-cause trace, the exact before/after code, the behavior matrix, and the rationale for why the old rule is obsolete post-single-instance + post-hot-exit).

## Global Constraints

- **OS:** Windows + Linux. Editor buffer is always LF-normalized (CRLF is a save-time concern). (AGENTS.md)
- **Encoding labels** (`"UTF-8"`, `"UTF-8 BOM"`, etc.) are a cross-process contract — do not touch. (AGENTS.md)
- **Test convention:** pure-logic tests only in `src/__tests__/` (no Tauri IPC mocking, no CodeMirror mocking). `main.ts` integration behavior is verified by manual smoke test + the existing automated suite staying green, not by a new unit test. (tabs spec §12, restore-on-launch spec §7)
- **Verify before claiming done:** run `npm test`, `npx tsc --noEmit`, `cargo test --manifest-path src-tauri/Cargo.toml`; all must pass. (AGENTS.md)
- **No commit/push without the plan carve-out:** this plan is approved spec/plan-driven work, so commit at task boundaries per AGENTS.md's carve-out. Branch from latest `main` (suggested `feat/restore-on-launch`). Do not push unless the user asks.
- **Catalog rule (AGENTS.md):** this change touches only `src/main.ts` (code) plus three files under `docs/artifacts/specs/` (the new spec, the new plan, and amendments to two existing specs). No new Tauri command, no `fileio.ts` wrapper, no `tauri.conf.json`/`capabilities`/deps/`index.html` change. If the implementer finds they need to touch any other catalog, stop and re-check.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/main.ts` | App lifecycle, startup IIFE, tab orchestration | **Modify** the startup IIFE branch (currently lines 453-459). Invert: always `restoreSessionOrNew()`, then `openPath(startupFile)` only if present. Update the comment. |
| `docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md` | This feature's design | **Create** (already written by the planner; the implementer commits it with the code). |
| `docs/artifacts/plans/restore-on-launch/2026-08-02-restore-on-launch-plan.md` | This feature's plan | **Create** (already written by the planner; the implementer commits it with the code). |
| `docs/artifacts/specs/tabs/2026-07-18-tabs-and-session-restore-design.md` §8 | Old "skip restore on file arg" rule | **Amend** the "Multi-instance" subsection (lines ~336-349) to point at the new spec and note the rule was obsoleted by single-instance + hot-exit. |
| `docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md` §5 | "Nothing else … changes" sentence | **Amend** line ~101 with a forward-reference to the restore-on-launch spec. |

No other files change. In particular: `src/session.ts`, `src/tabs.ts`, `src/document.ts`, `src/fileio.ts`, `src/menu.ts`, `src-tauri/src/main.rs`, `src-tauri/src/fs_cmds.rs` (so `get_startup_file` stays as-is), `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, and `index.html` are **untouched**.

---

## Task 1: Always restore, then open the startup file

**Files:**
- Modify: `src/main.ts` — the startup IIFE (search for `const startupFile = await getStartupFile()`; currently lines 446-460).
- Create (commit alongside): `docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md`, `docs/artifacts/plans/restore-on-launch/2026-08-02-restore-on-launch-plan.md` (already on disk from the planner; the implementer just stages them).

**Interfaces:**
- Consumes (already defined, unchanged):
  - `getStartupFile(): Promise<string | null>` (`src/fileio.ts:23-25` → `#[tauri::command] get_startup_file` in `src-tauri/src/fs_cmds.rs:112-117`) — returns `argv[1]` if it's an existing file, else `null`.
  - `restoreSessionOrNew(): Promise<void>` (`src/main.ts:462-510`) — rebuilds tabs from `localStorage["klad-session"]` (dirty named buffers restored with edits, clean named files re-read from disk, dirty untitled buffers restored with text); falls back to one fresh Untitled tab if no session. Dedups via `findTabByPath`. Ends with `persistSessionNow()`.
  - `openPath(path: string): Promise<void>` (`src/main.ts:292-310`) — dedups via `findTabByPath(coll, path)` (switches to existing tab if present); else reads the file and calls `appendAndActivate`, which makes the new tab active.
  - `listenOpenFile(handler)` registered at `src/main.ts:451` BEFORE the first `await` — unaffected by this change; the comment block at `main.ts:447-451` stays.
- Produces: nothing new. Later code is unchanged; this only changes the cold-start ordering of two existing calls.

**Context for the implementer (read spec §2 and §5, but the essential trace):** The startup IIFE at `main.ts:446-460` currently does `if (startupFile) openPath(startupFile) else restoreSessionOrNew()`. When a file arg is present, restore is skipped — so a cold double-click loses the saved session. The fix is to make restore unconditional and open the startup file afterward. Dedup makes the collision case (startup file already in session, clean or dirty) correct for free. Opening the startup file last makes it the active tab (desired UX). The single-instance forward path (already-running case) is untouched and already does the right thing.

- [ ] **Step 1: Read the current IIFE to confirm exact text and line numbers**

Read `src/main.ts` lines 446-460. Confirm the branch matches the spec's "current" block:

```ts
void (async () => {
  // Register the single-instance listener BEFORE the first await: ...
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

Note the exact line range for the edit.

- [ ] **Step 2: Replace the branch with restore-then-open**

Replace only the `const startupFile = ...` through the closing `})();` of the IIFE — leave the `void listenOpenFile(...)` line and its comment block above it **untouched**. The new block is exactly:

```ts
  const startupFile = await getStartupFile();
  // Always restore the saved session (untitled notes + previously opened files),
  // then open the OS-provided startup file alongside it. openPath dedups by path,
  // so if the startup file is already in the session it just switches to it.
  // See docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md
  // (supersedes the old tabs-§8 "skip restore on file arg" rule).
  await restoreSessionOrNew();
  if (startupFile) {
    await openPath(startupFile);
  }
})();
```

Leave everything else in `src/main.ts` untouched — especially `listenOpenFile` registration and its comment, `restoreSessionOrNew`, `openPath`, `findTabByPath`, `persistSessionNow`, and `getStartupFile`. Do **not** touch `src-tauri/src/fs_cmds.rs` (`get_startup_file` stays returning only `argv[1]`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0, no output (no type errors).

- [ ] **Step 4: Run the existing frontend test suite (must stay green, unchanged)**

Run: `npm test`
Expected: all test files pass, 0 failed. The 10 `session.test.ts` tests (including "toSession persists text for all dirty tabs" and the dirty-named-buffer round-trip) and the `singleinstance.test.ts` `extractPaths` tests must all pass — they cover the contracts this change relies on. No new tests are added (spec §7: the changed code is an imperative UI handler in the startup IIFE; pure logic is already covered).

- [ ] **Step 5: Run the backend test suite (no Rust change; regression guard)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: `test result: ok. 12 passed; 0 failed` (or whatever the current count is — must be 0 failed).

- [ ] **Step 6: Manual smoke test — cold-start with a file arg (the real acceptance test)**

This change is verifiable by **simulating a double-click cold start**: launching the klad binary with a file path as `argv[1]` while no klad instance is running. The fastest iteration loop is to build the debug binary once and invoke it directly, so each scenario is a sub-second launch rather than a full `tauri dev` rebuild.

Build once:
```bash
cargo build --manifest-path src-tauri/Cargo.toml
```
This produces `src-tauri/target/debug/klad.exe` (Windows) or `src-tauri/target/debug/klad` (Linux). All scenarios below invoke that binary directly. **Before each scenario**, ensure no klad instance is running (close it fully from the previous scenario) so each launch is a true cold start that exercises `get_startup_file` → `argv[1]`.

Prep: create two real test files (the `is_file()` filter in `get_startup_file` requires real files; non-existent paths fall through to restore-only):
- `C:\Users\ruben\AppData\Local\Temp\opencode\a.txt` containing `alpha`
- `C:\Users\ruben\AppData\Local\Temp\opencode\b.txt` containing `beta`
- `C:\Users\ruben\AppData\Local\Temp\opencode\c.txt` containing `gamma`

Reset session state before scenario 1: launch klad once with no args, open devtools (or use the running app), run `localStorage.removeItem("klad-session")`, close klad.

1. **Untitled + file (the headline case):** Launch klad with no args → `Ctrl+N` → type `note A` → close the window (hot-exit stashes the dirty untitled buffer). Now cold-launch with a file: `& "src-tauri/target/debug/klad.exe" "C:\Users\ruben\AppData\Local\Temp\opencode\a.txt"`. **Expect:** tabs are `[Untitled(dirty, "note A"), a.txt]`, with **a.txt active**. (This is the user's literal request.)
2. **Previously opened files + new file:** From the state after scenario 1, open `b.txt` too (File → Open, or `Ctrl+O`), then close the window (session now stashes `[Untitled, a.txt, b.txt]`, a.txt active — or whatever was active). Cold-launch with c.txt: `& "src-tauri/target/debug/klad.exe" "C:\Users\ruben\AppData\Local\Temp\opencode\c.txt"`. **Expect:** tabs are `[Untitled(dirty, "note A"), a.txt, b.txt, c.txt]`, **c.txt active**.
3. **Dirty named buffer preserved across a file launch (collision-dirty):** Open `a.txt` (already in session as clean) → append ` EDITED` in the editor → close the window (hot-exit stashes a.txt dirty with `alpha EDITED`). Cold-launch with a.txt again: `& "src-tauri/target/debug/klad.exe" "C:\Users\ruben\AppData\Local\Temp\opencode\a.txt"`. **Expect:** tabs include exactly one `a.txt` (deduped, not duplicated), it is **dirty**, its buffer reads `alpha EDITED`, and it is the active tab. Then verify disk: `Get-Content "C:\Users\ruben\AppData\Local\Temp\opencode\a.txt"` → **expect** it still reads `alpha` (disk **not** written on close; the stashed dirty buffer won on restore, and `openPath(a.txt)` deduped to the restored tab instead of re-reading disk).
4. **Clean collision dedups:** Reset a.txt to `alpha` on disk. Launch klad with no args, open a.txt, make no edits, close (session stashes a.txt clean). Cold-launch with a.txt: `& "src-tauri/target/debug/klad.exe" "C:\Users\ruben\AppData\Local\Temp\opencode\a.txt"`. **Expect:** exactly one a.txt tab (deduped, not two), not dirty, active.
5. **No-session cold start still works (regression guard):** Stop klad. Reset: `localStorage.removeItem("klad-session")` (launch once bare, clear, close). Cold-launch with no args: `& "src-tauri/target/debug/klad.exe"`. **Expect:** one fresh Untitled tab, not dirty. (Confirms the `else` path still works when no startup file.)
6. **No-session cold start with a file (regression guard):** With session still empty, cold-launch with a.txt: `& "src-tauri/target/debug/klad.exe" "C:\Users\ruben\AppData\Local\Temp\opencode\a.txt"`. **Expect:** tabs are `[Untitled, a.txt]`, a.txt active. (This is the spare-Untitled case from spec §6 row 3; documented as acceptable YAGNI.)
7. **Already-running forward path unchanged (regression guard):** Launch klad bare (`& "src-tauri/target/debug/klad.exe"`). With it still running, launch again with a file: `& "src-tauri/target/debug/klad.exe" "C:\Users\ruben\AppData\Local\Temp\opencode\b.txt"`. **Expect:** no second window appears; the existing instance comes to the foreground and opens b.txt as a new tab next to whatever was already there. (Confirms the single-instance forward path was not broken.)

All seven must pass. If any fails, do **not** commit — re-read spec §2 (root cause), §3 (why the combination is safe), §5 (the change), and §6 (behavior matrix); confirm the edit matches Step 2 exactly; confirm `listenOpenFile` registration and `get_startup_file` were not touched.

- [ ] **Step 7: Commit on the feature branch**

Ensure you are on a branch cut from latest `main` (e.g. `feat/restore-on-launch`). Stage the code change plus the new spec and plan:

```bash
git status   # confirm branch
git add src/main.ts docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md docs/artifacts/plans/restore-on-launch/2026-08-02-restore-on-launch-plan.md
git status   # confirm ONLY these three files staged
git commit -m "fix(startup): restore session when launching with a file arg

Invert the startup IIFE branch in main.ts: always call restoreSessionOrNew(),
then openPath(startupFile) only if a startup file is present. Previously a
cold double-clicked-file launch (OS passes the path as argv[1], klad not
already running) skipped restore entirely, losing unsaved untitled notes and
previously opened files. Now the file lands alongside the restored session,
matching the already-running (single-instance forward) behavior.

The old 'skip restore on file arg' rule (tabs spec §8) was defensive against
multi-instance last-writer-wins; single-instance mode plus hot-exit (which
now stashes every dirty buffer on close) made it obsolete. Dedup via
findTabByPath makes the collision case (startup file already in session,
clean or dirty) correct for free, and preserves stashed dirty edits without
re-reading disk. Opening the startup file last makes it the active tab."
```

(Do not push unless the user asks. AGENTS.md: default is no push without explicit instruction.)

---

## Task 2: Amend the two specs that documented the old rule

**Files:**
- Modify: `docs/artifacts/specs/tabs/2026-07-18-tabs-and-session-restore-design.md` §8 "Multi-instance" subsection (currently lines ~336-349).
- Modify: `docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md` §5 (currently line ~101).

**Interfaces:**
- Consumes: the new spec at `docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md` (committed in Task 1) — these amendments point at it.
- Produces: doc consistency. No code impact.

**Context for the implementer:** Two previously-shipped specs describe the behavior Task 1 just changed. AGENTS.md flags "two catalogs disagree about the same item" as a red flag; specs are klad's behavioral catalog, so they must not contradict the shipped code. These are documentation-only edits — small, surgical, preserving original heading anchors so old links still resolve.

- [ ] **Step 1: Read the exact text of both target sections**

Read:
- `docs/artifacts/specs/tabs/2026-07-18-tabs-and-session-restore-design.md` lines 336-349 (the "Multi-instance (non-goal, but documented behavior)" subsection).
- `docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md` line 101 (the sentence "Nothing else in `main.ts`, `session.ts`, `tabs.ts`, or the restore path changes.").

Confirm the exact text before editing.

- [ ] **Step 2: Amend tabs spec §8**

Replace the body of the "Multi-instance (non-goal, but documented behavior)" subsection (lines 337-349, **keeping the `### Multi-instance (non-goal, but documented behavior)` heading** so existing anchors resolve) with:

```markdown
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
```

(Leave the surrounding sections — `### Save / Save As` above and `## 9. Menu and keyboard` below — untouched.)

- [ ] **Step 3: Amend hot-exit spec §5**

In `docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md`, the sentence at line 101 currently reads:

> Nothing else in `main.ts`, `session.ts`, `tabs.ts`, or the restore path changes.

Replace it with:

> Nothing else in `main.ts`, `session.ts`, `tabs.ts`, or the restore path changes at authoring time. **Note added 2026-08-02:** the separate `docs/artifacts/specs/restore-on-launch/2026-08-02-restore-on-launch-design.md` later reopened the startup IIFE branch in `main.ts` to make session restore run even when klad is launched with a file argument — so dirty buffers stashed by this hot-exit change are no longer discarded on a cold double-click launch. That change is independent of the close-time behavior specified here.

(Leave the rest of §5 — the `persistSessionNow` bullet list and the "Why this is safe" subsection — untouched.)

- [ ] **Step 4: Verify no code regressed (docs-only change, but confirm)**

Run: `npx tsc --noEmit`
Expected: exit code 0 (sanity — no accidental file touch).

Run: `npm test`
Expected: all pass, 0 failed (unchanged).

(No smoke test needed — this task changes only Markdown.)

- [ ] **Step 5: Commit the doc amendments**

```bash
git add docs/artifacts/specs/tabs/2026-07-18-tabs-and-session-restore-design.md docs/artifacts/specs/hot-exit/2026-08-01-hot-exit-design.md
git status   # confirm ONLY these two files staged
git commit -m "docs(specs): note restore-on-launch supersedes tabs §8 and hot-exit §5

Amend the two previously-shipped specs that documented the old 'skip session
restore on CLI file arg' rule, so the docs no longer contradict the shipped
code. tabs §8 is rewritten to point at the restore-on-launch spec and explain
why single-instance + hot-exit made the rule obsolete (heading preserved for
link anchor stability). hot-exit §5 gets a forward-reference noting that the
startup branch was later reopened. Documentation-only; no code or test impact."
```

---

## Self-Review (run after writing, before dispatch)

- [x] **Spec coverage:**
  - Spec §1 (problem) → Task 1 context block + commit message.
  - Spec §2 (root cause, the IIFE branch) → Task 1 Step 1 (read) + Step 2 (replace).
  - Spec §3 (why combination is safe — dedup, untitled, single-instance listener) → Task 1 interfaces block + the "do not touch" callouts in Step 2; collision-dirty and clean-collision scenarios in Step 6 (scenarios 3 & 4).
  - Spec §4 goals/non-goals → Global Constraints (no multi-file argv, no mtime, no toggle, no forward-path change) + Step 2 "do not touch `get_startup_file`."
  - Spec §5 (the change, exact code) → Task 1 Step 2 verbatim.
  - Spec §6 behavior matrix → Task 1 Step 6 scenarios 1-7 map to the matrix rows (1→row "Cold, double-clicked file", 2→row "Cold, double-clicked file" with prior files, 3→row "Cold, double-clicked file already in session (dirty)", 4→row "(clean)", 5→row "Cold, no file", 6→row "Cold, no session, double-clicked file", 7→row "Already running").
  - Spec §7 testing → Task 1 Steps 3-6 (typecheck, frontend, backend, smoke); explicit "no new automated test" rationale in Step 4.
  - Spec §8 doc amendments → Task 2 in full (both files, exact replacement text).
  - Spec §9 catalogs → Global Constraints "catalog rule" + File Structure "untouched" list.
  - Spec §10 resolved decisions → all reflected (active tab = startup file via opening last; spare Untitled kept = scenario 6 accepts it; multi-file argv out of scope).
  - Spec §11/§12 (no open issues) → nothing to map.
  All spec sections mapped.
- [x] **Placeholder scan:** no TBD/TODO/"add error handling"/"similar to". Task 1 Step 2 contains the exact replacement code. Task 2 Steps 2-3 contain the exact replacement Markdown. All commands have expected output. Smoke scenarios use concrete file paths and PowerShell-native invocation (`& "path"`).
- [x] **Type consistency:** No new types or functions introduced. `getStartupFile()`, `restoreSessionOrNew()`, `openPath()`, `listenOpenFile()` are existing signatures, called unchanged. The IIFE's outer `void (async () => { ... })();` shape is preserved.

## Execution Handoff

Plan complete and saved to `docs/artifacts/plans/restore-on-launch/2026-08-02-restore-on-launch-plan.md`. Dispatching the orchestrator to execute both tasks on a `feat/restore-on-launch` branch (single-pass, no approval gates per the planner pipeline).
