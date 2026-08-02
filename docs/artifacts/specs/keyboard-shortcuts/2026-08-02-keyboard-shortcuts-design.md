# Keyboard Shortcuts for Browser-Intercepted Actions — Design

- **Date:** 2026-08-02
- **Topic:** `keyboard-shortcuts`
- **Status:** Spec (approved, ready to execute)
- **Scope:** Frontend-only. Extend one existing `window` keydown listener in `src/main.ts` (currently handles Ctrl+W / Ctrl+Tab) to also cover Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S. No Rust, no new modules, no new deps, no catalog additions, no menu change.
- **Author:** Planner session 2026-08-02 (bug discovered while smoke-testing `feat/restore-on-launch`)
- **Depends on:** nothing new (menu wiring in `src/menu.ts` and `doNew`/`doOpen`/`doSave`/`doSaveAs` in `src/main.ts` are unchanged).
- **Related:** comment at `src/main.ts:429-431` already documents this exact class of fallback.

## 1. Problem (with evidence)

User reports: "the hotkeys dont work. no ctrl S to save nor ctrl N for new."

Discriminating evidence gathered via the `systematic-debugging` skill (Phase 1):

| Observation | Implication |
|---|---|
| Menu bar (File / Edit / View / Tabs / Format) is visible | `Menu.new().setAsAppMenu()` succeeded. Menu is registered. |
| Clicking File → New / File → Save with the mouse works | Action callbacks (`newFile`, `saveFile`, …) fire correctly. |
| Ctrl+W (close tab) works | Has a JS `keydown` fallback at `src/main.ts:432-444`. |
| Ctrl+Tab (next tab) works | Same JS `keydown` fallback. |
| Ctrl+P (print) works | Both the browser default **and** the menu action do the same thing (`window.print()`); the user sees the print dialog either way. |
| Ctrl+N, Ctrl+S, Ctrl+O do **not** work | No JS fallback; menu accelerator is the only path — and it doesn't fire (see §2). |

## 2. Root cause

On Windows, klad's webview is **WebView2** (Edge/Chromium). WebView2 intercepts a fixed set of "browser shortcuts" and swallows them at the webview layer **before** the Tauri menu accelerator (registered at the Win32 menu level) sees the keystroke. The intercept set includes exactly the classic browser actions:

- Ctrl+N (new window)
- Ctrl+O (open file)
- Ctrl+S (save page)
- Ctrl+Shift+S (save page as)
- Ctrl+W (close tab) — already mitigated
- Ctrl+P (print) — coincidentally works (same action both layers)

For the Ctrl+S/N/O class, the keydown event **does** still reach the webview's `window` listener (it's only the accelerator that's swallowed), so a JS `keydown` handler can intercept and reroute them. The Tauri menu accelerator cannot be made to fire for these via app code — it's an upstream WebView2 behavior.

The existing `keydown` handler at `src/main.ts:429-444` already implements exactly this reroute for Ctrl+W and Ctrl+Tab, with a comment that names the rationale:

```ts
// Defense in depth: the Tauri menu accelerator already handles Ctrl+W / Ctrl+Tab on
// most platforms, but this window-level keydown still fires (e.g. when the menu
// accelerator is disabled or in dev builds), so we let it close/switch here too.
```

The same defense is needed for the file-action shortcuts the user is hitting. Not a regression from the session-restore / hot-exit / restore-on-launch work — this has been latent since `d4b3c18 feat(tabs): add keyboard shortcuts and Tabs menu`.

## 3. Why not "fix the accelerator"?

Two alternatives considered and rejected:

1. **Disable WebView2's browser shortcuts globally** (Tauri config / Windows API). Platform-specific, heavier, and the keydown fallback already exists as the established in-repo pattern. Rejected.
2. **File an upstream Tauri/WebView2 issue and wait.** Doesn't help the user now. Rejected.

The keydown fallback is the lazy, correct fix: it's already there for two keys, it works, extend it.

## 4. The change

Extend the existing `window.addEventListener("keydown", …)` block at `src/main.ts:432-444` to also handle `n`, `o`, `s` (and `s` + shift for Save As). Each branch calls `e.preventDefault()` (to suppress the WebView2 browser default) and dispatches to the same function the menu action uses.

New body of the listener (replaces the current `if/else if` for `w`/`Tab`):

```ts
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

That is the entire code change. Update the comment above it (currently lines 429-431) to reflect the wider coverage and the WebView2 intercept root cause.

### Why no double-action
On Windows/WebView2, when a menu accelerator fires, the keystroke is consumed at the Win32 menu loop and the webview `keydown` does **not** fire. When WebView2 intercepts the key as a browser shortcut, the accelerator does **not** fire but `keydown` does. So adding these branches can't cause both paths to run for one keystroke — it only fills in when the accelerator was swallowed. (Same property that lets the existing Ctrl+W/Tab branches ship without double-close.) On Linux (WebKitGTK), the accelerator handles these and the keydown is a harmless no-op duplicate that `e.preventDefault()` neutralizes.

### Functions consumed (all in `src/main.ts`, unchanged)
- `doNew(): Promise<void>` (`main.ts:288`)
- `doOpen(): Promise<void>` (`main.ts:312`)
- `doSave(): Promise<void>` (`main.ts:317`)
- `doSaveAs(): Promise<void>` (`main.ts:334`)

## 5. Non-goals (YAGNI)

- **Ctrl+F / Ctrl+H / Ctrl+G** (find/replace/goto): CodeMirror 6's `@codemirror/search` binds Ctrl+F; the menu accelerator handles the others. User reported no issue. Not touched.
- **Ctrl+= / Ctrl+- / Ctrl+0** (zoom): WebView2 zoom is handled at the app/embedder level; user reported no issue. Not touched.
- **Ctrl+Shift+M / Ctrl+Shift+L** (preview/theme): no browser default to intercept; accelerator works. Not touched.
- **A general "keyboard shortcut" framework / keymap abstraction.** Four more `else if` branches in one handler. No abstraction needed.
- **Disabling WebView2 browser shortcuts globally.** Rejected per §3.

## 6. Testing strategy

Per project convention (tabs spec §12): `main.ts` integration behavior is **not** unit-tested; pure logic is already covered. The verification bar is the existing automated suite staying green + a focused manual smoke.

### Automated (must stay green)
- `npx tsc --noEmit` — 0 errors.
- `npm test` — vitest suite, 0 failed.
- `cargo test --manifest-path src-tauri/Cargo.toml` — 0 failed (no Rust change; regression guard).

### Manual smoke (acceptance)
Build the binary: `cargo build --manifest-path src-tauri/Cargo.toml`. Launch `src-tauri/target/debug/klad.exe`. For each shortcut, focus the editor, press the combo, and verify:

1. **Ctrl+N** → new untitled tab is created and activated. (WebView2's "new window" default must NOT fire — no second klad window appears.)
2. **Ctrl+O** → the OS file-open dialog appears. (WebView2's "open file" default must NOT fire — or if it does, it's the same dialog, no double.)
3. **Ctrl+S on a clean untitled tab** → triggers Save As (file dialog). On a named clean tab → no-op (already clean). On a dirty named tab → writes to disk, dirty clears.
4. **Ctrl+Shift+S** → Save As dialog (regardless of dirty/path state).
5. **Regression guards:** Ctrl+W still closes a tab; Ctrl+Tab still cycles tabs; Ctrl+P still opens print; clicking File → Save with the mouse still works; typing `s`, `n`, `o` **without** Ctrl in the editor still inserts those characters (the handler returns early when `!ctrl`).

All five must pass. The Ctrl+N case is the most important to verify no second window spawns (proves `preventDefault` worked).

## 7. Catalog updates (per AGENTS.md)

| Catalog | Touched? |
|---|---|
| `src-tauri/src/main.rs` `invoke_handler![]` | No |
| `src/fileio.ts` | No |
| `src-tauri/tauri.conf.json` | No |
| `src-tauri/capabilities/default.json` | No |
| `package.json` / `Cargo.toml` deps | No |
| `index.html` | No |
| `src/menu.ts` | No — menu and accelerators unchanged; the fallback only reroutes to the same action fns. |

Only `src/main.ts` is modified. No red flags.

## 8. Resolved decisions

| Decision | Resolution |
|---|---|
| Mechanism | Extend existing `window` keydown fallback. |
| Scope of keys added | N, O, S, Shift+S (the browser-intercepted file actions). |
| preventDefault | Yes, on every branch (suppresses WebView2 browser default; neutralizes Linux no-op dup). |
| New tests | None (integration handler; existing suite stays green; manual smoke is the bar). |
| Menu change | None. |

## 9. Open issues

None. Root cause confirmed by evidence (§1); fix matches established in-repo pattern (§2, §3).
