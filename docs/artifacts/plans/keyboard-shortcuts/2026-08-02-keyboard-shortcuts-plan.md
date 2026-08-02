# Keyboard Shortcuts for Browser-Intercepted Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ctrl+N, Ctrl+O, Ctrl+S, and Ctrl+Shift+S actually fire their menu actions on Windows/WebView2, by extending the existing `window` keydown fallback in `src/main.ts` to cover them (WebView2 swallows these as browser shortcuts before the Tauri menu accelerator can fire).

**Architecture:** One listener, four more `else if` branches, each calling `e.preventDefault()` then dispatching to the same `doNew` / `doOpen` / `doSave` / `doSaveAs` the menu uses. No new module, no menu change. The existing Ctrl+W/Ctrl+Tab branches already established this pattern.

**Tech Stack:** TypeScript, Tauri 2 (WebView2 webview on Windows, WebKitGTK on Linux), vitest, cargo. Frontend-only.

**Spec:** `docs/artifacts/specs/keyboard-shortcuts/2026-08-02-keyboard-shortcuts-design.md` (read this first — it contains the evidence table confirming the root cause and the rationale for why the accelerator can't be fixed at the Tauri level).

## Global Constraints

- **OS:** Windows + Linux. The bug manifests on Windows (WebView2); Linux (WebKitGTK) is unaffected but the keydown fallback is a harmless no-op duplicate there, neutralized by `preventDefault`.
- **Test convention:** pure-logic tests only in `src/__tests__/`; `main.ts` integration behavior verified by manual smoke + existing automated suite staying green. No new unit test. (tabs spec §12, keyboard-shortcuts spec §6)
- **Verify before claiming done:** `npx tsc --noEmit`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml` — all must pass.
- **No commit/push without the plan carve-out:** approved spec/plan-driven work; commit at the task boundary. Do not push.
- **Catalog rule (AGENTS.md):** only `src/main.ts` is touched. No menu change, no new command, no `fileio.ts`/`main.rs`/`tauri.conf.json`/`capabilities`/deps/`index.html` change. If the implementer finds they need to touch any other catalog, STOP and re-check.
- **Branch:** this is a pre-existing bug, not a regression from the session work. It can land on `feat/restore-on-launch` (current testing branch) as a clearly-scoped `fix(hotkeys):` commit, OR on its own `fix/keyboard-shortcuts` branch from `main`. Pick `feat/restore-on-launch` so the user can rebuild and test immediately without switching branches. Note in the commit message that it's a pre-existing bug.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/main.ts` | App lifecycle, the window `keydown` fallback at lines 429-444 | **Modify** the keydown listener: add `n`, `o`, `s` (+shift) branches; update the comment above it. |
| `docs/artifacts/specs/keyboard-shortcuts/2026-08-02-keyboard-shortcuts-design.md` | This feature's design | **Create** (already on disk from the planner; the implementer commits it with the code). |
| `docs/artifacts/plans/keyboard-shortcuts/2026-08-02-keyboard-shortcuts-plan.md` | This feature's plan | **Create** (already on disk from the planner; the implementer commits it with the code). |

No other files change. In particular: `src/menu.ts` (menu + accelerators stay exactly as-is), `src/tabs.ts`, `src/document.ts`, `src/fileio.ts`, `src/dialogs.ts`, the entire `src-tauri/` tree, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `index.html` are **untouched**.

---

## Task 1: Extend the keydown fallback to N / O / S / Shift+S

**Files:**
- Modify: `src/main.ts` — the `window.addEventListener("keydown", …)` block, currently at lines 429-444 (comment + listener).

**Interfaces:**
- Consumes (already defined, unchanged):
  - `doNew(): Promise<void>` (`src/main.ts:288`) — same fn the menu's `newFile` action calls.
  - `doOpen(): Promise<void>` (`src/main.ts:312`) — same fn the menu's `openFile` action calls.
  - `doSave(): Promise<void>` (`src/main.ts:317`) — same fn the menu's `saveFile` action calls.
  - `doSaveAs(): Promise<void>` (`src/main.ts:334`) — same fn the menu's `saveFileAs` action calls.
  - `coll.activeId`, `closeTabById`, `prevTab`, `nextTab`, `switchToTab` — already used by the existing Ctrl+W/Tab branches.
- Produces: nothing new. The menu wiring is unchanged; this only adds a parallel keyboard path that fires when WebView2 swallows the accelerator.

**Context for the implementer (read spec §1-§2):** The Tauri menu registers accelerators for Ctrl+N/S/O/Shift+S correctly (`src/menu.ts:44-47`), and clicking those menu items works. But on Windows, WebView2 intercepts these four as browser shortcuts (new-window / open-file / save-page / save-page-as) and swallows them before the Win32 menu accelerator fires. The keydown event still reaches the webview's `window` listener, so a JS fallback can reroute them. The existing Ctrl+W/Ctrl+Tab branches at `main.ts:432-444` already do this for those two keys; the comment at `main.ts:429-431` documents the rationale. Extend the same handler with four more branches.

- [ ] **Step 1: Read the current listener to confirm exact text and line numbers**

Read `src/main.ts` lines 429-444. Confirm it matches:

```ts
// Defense in depth: the Tauri menu accelerator already handles Ctrl+W / Ctrl+Tab on
// most platforms, but this window-level keydown still fires (e.g. when the menu
// accelerator is disabled or in dev builds), so we let it close/switch here too.
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

Note the exact line range for the edit.

- [ ] **Step 2: Replace the comment + listener with the extended version**

Replace the comment block (lines 429-431) AND the entire `window.addEventListener("keydown", …)` body with exactly:

```ts
// WebView2 (Windows) swallows a fixed set of "browser shortcuts" — Ctrl+N/O/S/Shift+S
// and Ctrl+W — before the Tauri menu accelerator can see them. The accelerator is
// unreachable from app code for these keys, but the keydown still fires on window,
// so we reroute them here to the same fns the menu uses. On Linux (WebKitGTK) the
// accelerator handles them and this is a no-op duplicate, neutralized by preventDefault.
window.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  const key = e.key.toLowerCase();
  if (key === "w") {
    e.preventDefault();
    const id = coll.activeId;
    if (id) void closeTabById(id);
  } else if (key === "tab") {
    e.preventDefault();
    const target = e.shiftKey ? prevTab(coll) : nextTab(coll);
    if (target.activeId && target.activeId !== coll.activeId) switchToTab(target.activeId);
  } else if (key === "n") {
    e.preventDefault();
    void doNew();
  } else if (key === "o") {
    e.preventDefault();
    void doOpen();
  } else if (key === "s") {
    e.preventDefault();
    void (e.shiftKey ? doSaveAs() : doSave());
  }
});
```

Two behavior notes vs. the old code:
- `e.key.toLowerCase()` normalizes the Shift state (Ctrl+Shift+S yields `e.key === "S"`; lowercasing lets one branch match both `s` and `S`). The old `e.key === "w" || e.key === "W"` is replaced by this and stays equivalent for `w`.
- `doSave()` vs `doSaveAs()` is selected by `e.shiftKey` inside the `s` branch.

Leave everything else in `src/main.ts` untouched — especially `setupMenu`, the menu action callbacks, `doNew`/`doOpen`/`doSave`/`doSaveAs` bodies, `closeTabById`, `switchToTab`, `listenOpenFile`, and the startup IIFE. Do **not** touch `src/menu.ts`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0, no output. If `doNew`/`doOpen`/`doSave`/`doSaveAs` are flagged as unresolved, you mis-scoped the edit (they're module-level functions at `main.ts:288/312/317/334`, in scope at the listener).

- [ ] **Step 4: Run the existing frontend test suite (must stay green, unchanged)**

Run: `npm test`
Expected: all test files pass, 0 failed. No new tests are added (spec §6: integration handler; pure logic already covered).

- [ ] **Step 5: Run the backend test suite (no Rust change; regression guard)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: `test result: ok. … 0 failed`.

- [ ] **Step 6: Manual smoke test (the real acceptance bar)**

Build the binary once: `cargo build --manifest-path src-tauri/Cargo.toml`. Launch `src-tauri/target/debug/klad.exe`. For each scenario, focus the editor (click in it) first, then press the combo:

1. **Ctrl+N** → a new untitled tab is created and activated. **Critical:** no second klad window spawns (proves `preventDefault()` suppressed WebView2's "new window" default). Verify by checking the OS taskbar / `Get-Process klad` shows exactly one klad process (plus the dev tools if open).
2. **Ctrl+O** → the OS file-open dialog appears. Cancel it (Esc). No file opens. (Verifies the open path; WebView2's own "open file" default, if any, is the same dialog so no visible double.)
3. **Ctrl+S on a clean untitled tab** → Save As dialog appears (because untitled has no path). Cancel it.
4. **Ctrl+S on a dirty named tab** → writes to disk, the dirty dot clears. Prep: open a real file (e.g. `C:\Users\ruben\AppData\Local\Temp\opencode\a.txt` containing `alpha`), append ` X` in the editor, press Ctrl+S. Expect: dirty dot clears; `Get-Content a.txt` reads `alpha X`.
5. **Ctrl+Shift+S** → Save As dialog appears (regardless of current tab state), even on a named clean tab.
6. **Regression — Ctrl+W** still closes the current tab (or prompts on dirty).
7. **Regression — Ctrl+Tab** still cycles to the next tab.
8. **Regression — Ctrl+P** still opens the print dialog.
9. **Regression — mouse menu** — clicking File → New / File → Save still works (the menu action path is unchanged).
10. **Regression — plain typing** — with no modifier held, typing `n`, `o`, `s` into the editor still inserts those characters (the handler returns early on `!ctrl`; `.toLowerCase()` on a non-Ctrl `n` is harmless).

All ten must pass. If any fails, do **not** commit — re-read spec §1 (evidence) and §4 (the change); confirm the edit matches Step 2 exactly; confirm `src/menu.ts` was not touched and the four `do*` functions were not modified.

- [ ] **Step 7: Commit on the feature branch**

Ensure you are on `feat/restore-on-launch` (current testing branch — see Global Constraints for the rationale). Stage the code change plus the new spec and plan:

```bash
git branch --show-current    # confirm feat/restore-on-launch
git add src/main.ts docs/artifacts/specs/keyboard-shortcuts/2026-08-02-keyboard-shortcuts-design.md docs/artifacts/plans/keyboard-shortcuts/2026-08-02-keyboard-shortcuts-plan.md
git status                   # confirm ONLY these three files staged
git commit -m "fix(hotkeys): reroute Ctrl+N/O/S/Shift+S through the window keydown fallback

WebView2 (Windows) swallows Ctrl+N/O/S/Shift+S as browser shortcuts before the
Tauri menu accelerator can fire — the keys never reach the Win32 menu loop. The
keydown still reaches window, so extend the existing keydown fallback (which
already covered Ctrl+W/Ctrl+Tab) to also dispatch doNew/doOpen/doSave/doSaveAs
for those four. preventDefault suppresses the WebView2 browser default (e.g. no
second window on Ctrl+N). On Linux the accelerator handles them and this is a
harmless no-op duplicate. No menu change; same action fns.

Pre-existing bug since d4b3c18 (tabs keyboard shortcuts); surfaced while smoke-
testing feat/restore-on-launch. Not a regression from the session/hot-exit work."
```

(Do not push unless the user asks. AGENTS.md: default is no push without explicit instruction.)

---

## Self-Review (run after writing, before dispatch)

- [x] **Spec coverage:** Spec §1 (evidence table) → Task 1 context block + commit message. Spec §2 (root cause, WebView2 intercept) → Task 1 Step 2 comment + commit message. Spec §3 (why not fix accelerator) → Task 1 Global Constraints + "do not touch menu.ts." Spec §4 (the change, exact code) → Task 1 Step 2 verbatim. Spec §5 non-goals (no Ctrl+F/H/G, no zoom, no framework) → enforced by Step 2 adding only n/o/s branches. Spec §6 testing → Task 1 Steps 3-6 (typecheck, frontend, backend, 10-point smoke). Spec §7 catalogs → Global Constraints + File Structure "untouched" list. Spec §8 decisions → all reflected.
- [x] **Placeholder scan:** no TBD/TODO/"add error handling"/"similar to". Step 2 contains the exact replacement code. All commands have expected output. Smoke scenarios use concrete paths and explicit pass criteria.
- [x] **Type consistency:** No new types. `doNew`/`doOpen`/`doSave`/`doSaveAs` all `Promise<void>` per grep at planning time (`main.ts:288/312/317/334`). `void` prefix on each call matches the existing `void closeTabById(...)` pattern.

## Execution Handoff

Plan complete and saved to `docs/artifacts/plans/keyboard-shortcuts/2026-08-02-keyboard-shortcuts-plan.md`. Dispatching the orchestrator to execute the single task on `feat/restore-on-launch` (single-pass, no approval gates per the planner pipeline).
