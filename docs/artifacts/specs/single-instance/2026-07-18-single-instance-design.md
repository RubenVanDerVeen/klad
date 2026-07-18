# Single-Instance Mode — Design

- **Date:** 2026-07-18
- **Topic:** `single-instance`
- **Status:** Spec (awaiting review)
- **Scope:** Rust (single Tauri plugin + window ops) + frontend (event listener + openPath reuse). Small. No new Tauri commands.
- **Author:** Brainstorming session 2026-07-18
- **Resolves:** Tabs/session spec §11 known limitation "Multi-instance"

## 1. Problem

Klad today runs as one process per OS launch. If klad is already open and the user double-clicks another file in Explorer/Finder, the OS spawns a **second** klad process; that second process loads the file into its own (empty) session, the two instances now race on `localStorage`, and last-writer-wins when either closes. The existing tabs/session plan explicitly deferred this as §11 known limitation:

> Multi-instance. Two concurrently-running klad instances each maintain their own view of localStorage and overwrite the session on close. Last-writer-wins. Future fix: Tauri single-instance plugin forwarding argv to the running instance.

The fix is now scoped and approved.

## 2. Goals and non-goals

### Goals

- A second OS-launched `klad <path>` process forwards its file argument(s) to the **first** klad instance, opens the file(s) as new tab(s) in that instance's existing tab collection, raises the existing window to the front, and exits.
- A second OS-launched `klad` (no args) raises the existing window and exits (no new tab).
- First-launched klad is unchanged: its bootstrap, session restore, and tab lifecycle are untouched.
- LocalStorage is single-writer: only the running instance writes, so the last-writer-wins data-loss risk goes away.

### Non-goals (YAGNI for v1)

- **Multi-arg CLI.** `klad a.txt b.txt c.txt` keeps the existing single-path semantics. The original tabs/session spec §2 deferred multi-arg "until single-instance exists"; deferring it again — v1 of single-instance is forward-compatible with multi-arg (the plugin gives us the full argv array), we just don't iterate it.
- **Linux/macOS argv quirks for shell globbing.** The OS-launched process gets the literal argv from the shell; whatever the user typed or Explorer quoted is what we forward.
- **`--new-instance` escape hatch.** Some apps (Firefox, Code) provide a flag to bypass single-instance. Out of scope; add if anyone asks.
- **Inter-instance drag-drop / IPC beyond argv.** Not requested.
- **Migration of any pre-existing localStorage state.** Nothing to migrate.

## 3. Approach

Add `tauri-plugin-single-instance` to the Rust side. Its `init` callback receives `(app, argv, cwd)` whenever a second process tries to launch; the callback (a) emits a Tauri event to the `main` webview with the argv, then (b) raises the existing window. The second process exits automatically — the plugin handles the early-return.

The frontend's existing `openPath(path)` is the natural consumer for forwarded argv: it already handles dedup-or-create, missing-file errors via `showError`, and triggers session-save through `scheduleSessionSave`. We just need a one-time event listener that calls it for each forwarded path.

## 4. Architecture and data flow

```
OS shell        second klad process        first klad process       frontend
   |                   |                          |                     |
   |--- argv[1]==X -->|                          |                     |
   |                   |--- (plugin sees lock) ->|                     |
   |                   |    emits "single-instance" event              |
   |                   |    with argv, raises window                   |
   |                   |                          |--- emit("...",...)>|
   |                   |                          |                     |--- listen("single-instance")
   |                   |                          |                     |    skip argv[0]
   |                   |                          |                     |    openPath(argv[1..]) each
   |                   |                          |                     |    -> appendAndActivate
   |                   |                          |                     |    -> scheduleSessionSave
   |                   | exit                     |                     |
```

The second process never reaches `main()`'s `tauri::Builder::default()` for the dialog/webview startup — the plugin's lockfile/pipe intercepts before window construction. (Verified by Tauri's plugin docs and the `tauri-plugin-single-instance` README.)

## 5. Module and file changes

### New Rust dependencies

| Cargo | Purpose |
|---|---|
| `tauri-plugin-single-instance = "2"` | Lockfile-based single-instance + argv forward. |

### Modified files

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-single-instance = "2"` to `[dependencies]`. |
| `src-tauri/src/main.rs` | Add `.plugin(tauri_plugin_single_instance::init(...))` **before** `.plugin(tauri_plugin_dialog::init())`. Callback: emit event + raise window. Add `use serde::Serialize;` and `use tauri::Emitter;` and `use tauri::Manager;`. |
| `src-tauri/capabilities/default.json` | Add `core:window:allow-show`, `core:window:allow-set-focus`, `core:window:allow-unminimize` (needed for the raise-window sequence). |
| `src/fileio.ts` | Add a typed `listenOpenFile(handler: (path: string) => void): UnlistenFn` wrapper. (Mirrors `getStartupFile`'s wrapper style; thin facade over `@tauri-apps/api/event`.) |
| `src/main.ts` | One-time `listenOpenFile((p) => openPath(p))` call at the top of bootstrap (before `getStartupFile()` so the very first forwarded file can't race). The existing `openPath` is safe to call mid-restore because it dedups via `findTabByPath(coll, path)` against the in-progress restore. |

### New files

### Event payload contract

The Rust callback emits the literal shape `{ argv: string[]; cwd: string }` to the `main` webview under the event name `single-instance`. The frontend `listenOpenFile` wrapper in `src/fileio.ts` types the payload as `unknown` and validates that `argv` is an array of strings before iterating. The `cwd` field is unused in v1 but is included for future use (e.g. "Open File from CWD") so the contract is forward-compatible without another breaking change. The Rust `Payload` struct is private to `main.rs` and is `#[derive(Serialize)]`.

### Untouched (called out because AGENTS.md catalogs them)

`src-tauri/src/fs_cmds.rs` (no new Tauri commands), `src-tauri/tauri.conf.json` (no `fileAssociations` change), `package.json` (no new JS deps — frontend uses existing `@tauri-apps/api/event`), `src/tabs.ts`, `src/session.ts`, `src/tabbar.ts`, `src/document.ts`, `src/editor.ts`, `src/statusbar.ts`, `src/preview.ts`, `src/render.ts`, `src/settings.ts`, `src/dialogs.ts`, `index.html`, `src/styles.css`.

## 6. Behaviors

### Second launch with file arg (`klad /path/to/foo.txt`)

1. OS starts process P2 with argv = `["klad", "/path/to/foo.txt"]`.
2. The plugin's lock check in P2 detects P1 already holds the lock. Plugin sends argv + cwd to P1 via the OS-specific channel (named pipe on Windows, Unix socket on Linux/macOS). P2 exits with status 0.
3. P1's `init` callback fires on the main thread with `(app, argv, cwd)`. It:
   - Builds `Payload { argv, cwd }` and calls `app.emit_to("main", "single-instance", payload)`.
   - Calls `app.get_webview_window("main")` and runs the raise sequence: `unminimize()` (no-op if not minimized) → `show()` (no-op if visible) → `set_focus()`.
4. Frontend's `listenOpenFile` handler receives the payload, skips argv[0], and for each remaining entry calls `openPath(p)`. The existing logic dedups (file already open → switch to it), reads from disk (re-reads on every open — picks up external edits), and persists the new tab via `scheduleSessionSave`.

### Second launch with no args (`klad`)

1–3. Same as above, but argv[1..] is empty, so the frontend listener no-ops on the array and P1 raises its window. P2 exits.

### Second launch while P1 is mid-restore (Task 7 bootstrap still in flight)

The forwarded argv arrives on the same event channel as everything else; `openPath` is safe to call during restore (its dedup check `findTabByPath(coll, path)` covers files the restore loop is about to open or has already opened). The restore loop's own `openPath` calls and the listener's `openPath` calls interleave; both rely on the same reducers.

### Second launch while P1 is in shutdown dirty-walk (Task 7 `onCloseRequested`)

The forwarded argv arrives while a modal `askSave` is open. `openPath` calls `appendAndActivate` which calls `showOnly` and `paintTabBar`. The modal `askSave` blocks the dialog; once the user resolves it (save / discard / cancel), the `appWindow.destroy()` runs. If the user clicked Cancel, the new tab is now visible alongside the prompt; the user sees the file they double-clicked. If Save/Discard, the new tab is visible briefly then destroyed with the window. Acceptable for v1; document as a known quirk.

### P1 closes while P2 is mid-handoff

If the OS somehow delivers argv to a process that has just lost the lock (race window during shutdown), the callback runs after `appWindow.destroy()` has torn down the webview. The `emit_to` call no-ops on a dead webview; the `set_focus` no-ops on a destroyed window. P2 already exited at the lock-check step. Harmless.

### Plugin lockfile / socket cleanup on P1 exit

Handled by `tauri-plugin-single-instance`. The plugin removes its lockfile on graceful shutdown and unlinks the socket on Linux/macOS. We do nothing.

## 7. Catalog updates (per AGENTS.md "Adding features")

| Catalog | Touched? | Change |
|---|---|---|
| `src-tauri/Cargo.toml` | **Yes** | One new dep. |
| `src-tauri/src/main.rs` `invoke_handler![]` | No | No new Tauri command. |
| `src-tauri/src/main.rs` plugin chain | **Yes** | One new `.plugin(...)`. |
| `src-tauri/capabilities/default.json` | **Yes** | Three new `core:window:*` permissions. |
| `src/fileio.ts` | **Yes** | One new wrapper. |
| `src/main.ts` | **Yes** | One new listener call. |
| `src-tauri/tauri.conf.json` | No | No `fileAssociations` change. |
| `package.json` | No | No new npm dep. |
| `index.html` | No | No new IDs. |

No red flags: the single-instance plugin doesn't add a Tauri command, so there's no `invoke_handler!`/frontend-wrapper pair to forget.

## 8. Testing strategy

### Pure logic

None. The plugin's argv-forward is Rust-side; the frontend's event listener is glue code around an existing tested function (`openPath`).

### Build verification

- `npm run build` (TypeScript + Vite).
- `cd src-tauri && cargo test` — must remain green (regression gate; no Rust source changes, only Cargo.toml + main.rs additions).

### Manual smoke (in `npm run tauri dev`)

Per the project's existing convention for `main.ts`-driven integration work:

1. First launch `npm run tauri dev` → opens klad with one untitled tab.
2. From a separate terminal / Explorer, run `cargo run -- /path/to/some.txt` (or use the OS shell).
3. Verify: existing klad window comes to front, the named file opens as a new tab, no second window appears.
4. Double-click a different file from Explorer → existing window raises again, the file opens as a new tab. Two tabs now.
5. Close the foreground tab → tab closes; window stays.
6. Quit klad entirely. Re-run `cargo run -- /path/to/some.txt`. Verify: klad launches, file opens as a single tab (no restore conflict — first launch, no session yet).
7. Quit. Re-launch `npm run tauri dev` → session restore should bring back both named tabs from step 4.

### Smoke failure modes to verify

- Forwarded path that doesn't exist → `openPath`'s `showError` dialog.
- Forwarded path that's already open → `findTabByPath` dedups; existing tab becomes active.
- Forwarded during startup bootstrap → file opens alongside the restore (dedup applies).
- Forwarded during shutdown prompt → file opens visibly before window destroys.

## 9. Open issues

None. All design questions resolved in §2.
