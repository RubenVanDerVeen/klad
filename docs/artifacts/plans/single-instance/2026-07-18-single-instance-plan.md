# Single-Instance Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a second OS-launched klad process forward its file argument(s) to the already-running first instance, open them as new tab(s) there, raise the first window, and exit — eliminating the multi-process `localStorage` last-writer-wins data-loss risk called out in the tabs/session spec §11.

**Architecture:** Add `tauri-plugin-single-instance` as the first entry in the Rust plugin chain. Its `init` callback emits a `single-instance` Tauri event carrying `{ argv, cwd }` to the `main` webview and raises the window; the second process exits inside the plugin. The frontend's existing `openPath(path)` is the consumer; a thin `listenOpenFile` wrapper in `src/fileio.ts` subscribes to the event, runs a pure `extractPaths` validator that skips `argv[0]`, and dispatches each forwarded path through `openPath` (whose existing dedup / error / session-save path does the rest). No new Tauri commands, no new npm deps.

**Tech Stack:** Tauri 2 + new Cargo dep `tauri-plugin-single-instance = "2"`; `@tauri-apps/api/event` (ships inside the already-installed `@tauri-apps/api ^2.5.0`); Vitest 3 for the one pure helper.

**Spec:** `docs/artifacts/specs/single-instance/2026-07-18-single-instance-design.md`

## Global Constraints

Copied verbatim from the spec and `AGENTS.md`:

- **Branch:** `feat/tabs-and-session-restore` (already checked out at `65d48cb`). This plan lands on top of the tabs/session work that the spec's "Task 7" references — that work is already committed (`8f510ae`…`ea14fea`); this plan does not touch it.
- **No new Tauri command.** Per spec §5/§7, the single-instance plugin uses an event callback, not `#[tauri::command]`. Therefore `invoke_handler![]` is unchanged and no `invoke()` wrapper is added. The only new `src/fileio.ts` exports are `extractPaths` and the `listenOpenFile` event-subscription wrapper.
- **No new npm dependency.** `@tauri-apps/api/event` ships inside `@tauri-apps/api ^2.5.0` (already in `package.json`).
- **Editor buffer is always LF-normalized.** Inherited; `openPath` already routes through `read_file` which normalizes CRLF/CR → `\n`.
- **Encoding labels are a cross-process contract.** Not directly relevant (single-instance forwards paths, not contents), inherited from project conventions.
- **No web framework.** Vanilla DOM, native `<dialog>`, no React/Svelte.
- **Pure-logic tests only.** Existing convention (see `src/__tests__/settings.test.ts`, `src/__tests__/session.test.ts`): no Tauri IPC mocking, no CodeMirror mocking, no DOM mocking. The argv-extraction helper is pure and gets one new test file; the Rust callback and the `main.ts` listener wiring are glue and are verified by build + manual smoke.
- **Conventional Commits 1.0.0.** Scope = module (`feat(single-instance)`, `feat(fileio)`). Plan-executing agents commit on their own at task boundaries per the AGENTS.md spec/plan carve-out.
- **Run both test suites before claiming done:** `npm test` (vitest) and `cd src-tauri && cargo test`. Plus `npm run build` before claiming any integration task done.
- **Catalog discipline (AGENTS.md "Adding features").** Touched: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs` plugin chain, `src-tauri/capabilities/default.json`, `src/fileio.ts`, `src/main.ts`. NOT touched: `invoke_handler![]` contents, `src-tauri/tauri.conf.json`, `package.json`, `index.html`. The final task self-checks this with `git diff main --stat`.

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/__tests__/singleinstance.test.ts` | Unit tests for `extractPaths` (pure argv-parsing helper). |

### Modified files

| File | Responsibility change |
|---|---|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-single-instance = "2"` to `[dependencies]`. |
| `src-tauri/src/main.rs` | Register the single-instance plugin FIRST in the chain. Callback emits `single-instance` event + raises window. Add private `Payload` struct + `serde::Serialize` / `tauri::Emitter` / `tauri::Manager` imports. |
| `src-tauri/capabilities/default.json` | Add `core:window:allow-show`, `core:window:allow-set-focus`, `core:window:allow-unminimize` per spec §5. |
| `src/fileio.ts` | Import `listen` + `type UnlistenFn` from `@tauri-apps/api/event`. Add `extractPaths(payload: unknown): string[]` (pure, exported for testing) and `listenOpenFile(handler): Promise<UnlistenFn>` (thin wrapper). |
| `src/main.ts` | Import `listenOpenFile`; register it once at the top of the bootstrap IIFE, before `getStartupFile()`. |

### Untouched (called out because AGENTS.md catalogs them)

`src-tauri/src/fs_cmds.rs` (no new commands), `src-tauri/src/main.rs` `invoke_handler![]` contents (no new command registered), `src-tauri/tauri.conf.json` (no `fileAssociations` change), `package.json` (no new npm dep), `index.html` (no new IDs), `src/tabs.ts`, `src/session.ts`, `src/tabbar.ts`, `src/document.ts`, `src/editor.ts`, `src/statusbar.ts`, `src/preview.ts`, `src/render.ts`, `src/settings.ts`, `src/dialogs.ts`, `src/styles.css`.

---

## Task 1: Rust — register the single-instance plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: `tauri-plugin-single-instance = "2"` (external Cargo crate).
- Produces: emits a Tauri event named `"single-instance"` to the webview window labeled `"main"`, with payload `{ argv: string[]; cwd: string }`. Task 3's frontend listener subscribes to this exact event name and reads this exact payload shape — they are a contract across the IPC boundary.

**Why this task is first:** The plugin must compile and register before the frontend has anything to listen to. Verifying it via `cargo build` and a dev smoke also validates the capabilities permissions before the frontend integration lands.

- [ ] **Step 1: Add the Cargo dependency**

Edit `src-tauri/Cargo.toml`. In the `[dependencies]` section, add the new line so the result reads:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-single-instance = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
encoding_rs = "0.8"
chardetng = "0.1"
```

- [ ] **Step 2: Register the plugin in `main.rs`**

Replace the entire contents of `src-tauri/src/main.rs` with:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fs_cmds;

use serde::Serialize;
use tauri::{Emitter, Manager};

/// Payload forwarded from a second OS-launched klad process to the first.
/// `cwd` is unused in v1 but kept for forward-compat (e.g. "Open File from CWD")
/// so the contract doesn't need a second breaking change later.
#[derive(Serialize)]
struct Payload {
    argv: Vec<String>,
    cwd: String,
}

fn main() {
    tauri::Builder::default()
        // Single-instance MUST be first: its lock check runs before any other
        // plugin or window construction. A second process exits inside this
        // plugin before the rest of the builder executes.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let _ = app.emit_to("main", "single-instance", Payload { argv, cwd });
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs_cmds::read_file,
            fs_cmds::save_file,
            fs_cmds::get_startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Klad");
}
```

Notes for the executor:
- `Emitter` brings `emit_to`; `Manager` brings `get_webview_window`. Both are required in Tauri 2.
- `let _ =` discards the `Result<>` from emit/window calls on purpose: a forwarded event arriving during shutdown (dead webview / destroyed window) must not crash the callback. See spec §6 "P1 closes while P2 is mid-handoff."
- `Payload` is private to `main.rs` (not `pub`); only its serialized JSON shape crosses the IPC boundary.

- [ ] **Step 3: Add window capabilities**

Edit `src-tauri/capabilities/default.json` to add the three `core:window:*` permissions the raise-window sequence needs. The result:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "core:window:allow-close",
    "core:window:allow-destroy",
    "core:window:allow-set-title",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-unminimize"
  ]
}
```

Note (per spec §5): Tauri 2's ACL primarily gates webview-initiated `invoke` commands, so Rust-side `Window::set_focus()` / `show()` / `unminimize()` *may* not actually traverse this layer. If the Task 3 smoke test confirms the window raises correctly, these permissions are either required or harmless. Do **not** remove them in this plan without an explicit follow-up — the spec lists them.

- [ ] **Step 4: Verify the Rust side builds and existing tests pass**

From repo root:
```bash
cd src-tauri; cargo build
```
Expected: clean build. No warnings about unused imports (`Emitter`, `Manager`, `Serialize` are all referenced).

Then:
```bash
cd src-tauri; cargo test
```
Expected: all existing inline tests in `fs_cmds.rs` pass. No new Rust tests are added because the plugin callback is glue with no isolated unit (spec §8).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs src-tauri/capabilities/default.json
git commit -m "feat(single-instance): register tauri-plugin-single-instance

Plugin is first in the chain so its lock check runs before any other
plugin or window construction. A second OS-launched process forwards
its argv+cwd to the running instance via the 'single-instance' event,
raises the main window, and exits. Adds the three core:window:*
capabilities the raise-window sequence relies on. No new Tauri commands.

Spec: docs/artifacts/specs/single-instance/2026-07-18-single-instance-design.md"
```

(`src-tauri/Cargo.lock` is tracked — verify with `git status` after staging; include it if changed.)

---

## Task 2: Frontend — pure `extractPaths` helper + tests

**Files:**
- Modify: `src/fileio.ts`
- Create: `src/__tests__/singleinstance.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `extractPaths(payload: unknown): string[]`, exported from `src/fileio.ts`. Task 3's `listenOpenFile` calls this inside its event handler.

**Why this task is split out:** The argv validation ("is `argv` an array of strings? return `argv[1..]`") is the only pure logic in the whole feature. Extracting it as a named function lets us test it without mocking Tauri's event API — matching the project convention of "pure-logic tests only" (see `src/__tests__/session.test.ts` for the established style).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/singleinstance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractPaths } from "../fileio";

describe("extractPaths", () => {
  it("returns argv[1..] when argv is a string array", () => {
    const payload = { argv: ["klad", "/a.txt", "/b.md"], cwd: "/tmp" };
    expect(extractPaths(payload)).toEqual(["/a.txt", "/b.md"]);
  });

  it("returns [] when only argv[0] (the executable) is present", () => {
    expect(extractPaths({ argv: ["klad"], cwd: "/tmp" })).toEqual([]);
  });

  it("returns [] when argv is empty", () => {
    expect(extractPaths({ argv: [], cwd: "/tmp" })).toEqual([]);
  });

  it("rejects non-array argv", () => {
    expect(extractPaths({ argv: "klad", cwd: "/tmp" })).toEqual([]);
    expect(extractPaths({ argv: null, cwd: "/tmp" })).toEqual([]);
    expect(extractPaths({ cwd: "/tmp" })).toEqual([]);
  });

  it("rejects argv with non-string elements", () => {
    expect(extractPaths({ argv: ["klad", 42, "/b.md"], cwd: "/tmp" })).toEqual([]);
  });

  it("treats non-object payloads as no-op", () => {
    expect(extractPaths(null)).toEqual([]);
    expect(extractPaths(undefined)).toEqual([]);
    expect(extractPaths("not an object")).toEqual([]);
    expect(extractPaths(123)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — import error / `extractPaths` is not a function (it doesn't exist yet).

- [ ] **Step 3: Implement `extractPaths` in `src/fileio.ts`**

Append to the end of `src/fileio.ts`:

```ts
/**
 * Pull the forwarded file paths out of a "single-instance" event payload.
 * Returns argv[1..] (argv[0] is the executable name) when the payload is the
 * expected shape, otherwise []. Defensive: the payload crosses a process
 * boundary and a malformed one must never crash the listener.
 *
 * `cwd` is currently ignored (spec §5: forward-compat field only).
 */
export function extractPaths(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const argv = (payload as { argv?: unknown }).argv;
  if (!Array.isArray(argv)) return [];
  if (!argv.every((x) => typeof x === "string")) return [];
  return argv.slice(1) as string[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all six `extractPaths` cases green, plus the existing suites (`tabs`, `session`, `document`, `settings`, `render`, `debounce`) still green.

- [ ] **Step 5: Commit**

```bash
git add src/fileio.ts src/__tests__/singleinstance.test.ts
git commit -m "feat(fileio): add extractPaths pure helper for single-instance payloads

Validates the {argv, cwd} payload from a single-instance event and
returns argv[1..] (drops the executable name). Pure + unit-tested so
the wrapper added in the next commit stays thin. cwd is tolerated but
currently unused."
```

---

## Task 3: Frontend — `listenOpenFile` wrapper + bootstrap wiring

**Files:**
- Modify: `src/fileio.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `extractPaths` from Task 2; `listen` + `UnlistenFn` from `@tauri-apps/api/event`; the existing `openPath(path: string): Promise<void>` already defined in `src/main.ts`.
- Produces: `listenOpenFile(handler: (path: string) => void): Promise<UnlistenFn>`, exported from `src/fileio.ts`. The event name `"single-instance"` and payload shape are fixed by Task 1's Rust `emit_to` call — they must match exactly.

**Why this task is last:** It depends on both Task 1 (the event being emitted) and Task 2 (the path-extraction helper). Its verification is a manual smoke test that exercises the full Rust→frontend chain end-to-end.

- [ ] **Step 1: Add the `listenOpenFile` wrapper**

Edit `src/fileio.ts`. At the top of the file, extend the imports. Replace the first import line:

```ts
import { invoke } from "@tauri-apps/api/core";
```

with:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
```

Then append at the end of the file (after `extractPaths`):

```ts
/**
 * Subscribe to single-instance file-forward events. Each forwarded path
 * (argv[1..]) is passed to `handler`. Returns a Promise that resolves to
 * the Tauri unlisten function once the backend acknowledges the subscription
 * (Tauri's `listen` is async).
 *
 * Note on the return type: spec §5 notates the wrapper as `UnlistenFn`, but
 * the honest surface is `Promise<UnlistenFn>` because that is what
 * `@tauri-apps/api/event`'s `listen()` returns.
 */
export function listenOpenFile(handler: (path: string) => void): Promise<UnlistenFn> {
  return listen("single-instance", (event) => {
    for (const path of extractPaths(event.payload)) handler(path);
  });
}
```

- [ ] **Step 2: Wire the listener into the bootstrap**

Edit `src/main.ts`. First, extend the `./fileio` import to also bring in `listenOpenFile`. The current import on line 8 reads:

```ts
import { getStartupFile, readFile, saveFile } from "./fileio";
```

Change it to:

```ts
import { getStartupFile, listenOpenFile, readFile, saveFile } from "./fileio";
```

Then update the bootstrap IIFE (currently lines 444–452). Replace:

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
```

with:

```ts
void (async () => {
  // Register the single-instance listener BEFORE the first await: a forwarded
  // file can arrive during the getStartupFile() IPC roundtrip or during
  // restoreSessionOrNew(), and openPath's dedup (findTabByPath) makes either
  // arrival safe. Fire-and-forget the registration Promise.
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

The two `void` operators are intentional:
- Outer `void` on `listenOpenFile(...)` discards the registration `Promise<UnlistenFn>` — the listener lives for the lifetime of the process; we never unlisten.
- Inner `void` on `openPath(p)` makes the arrow function body an expression statement; Tauri event handlers don't await their handlers, and the existing `openPath` already swallows its own errors via `showError`.

- [ ] **Step 3: Build + unit-test verification**

From repo root:
```bash
npm run build
```
Expected: `tsc` compiles cleanly and Vite build succeeds. No "unused import" warnings about `listenOpenFile`, `listen`, or `UnlistenFn`.

Then:
```bash
npm test
```
Expected: all tests still pass — Task 2's `extractPaths` tests plus the existing suites.

- [ ] **Step 4: Manual smoke test (the integration gate)**

Run `npm run tauri dev`. Wait for the klad window to open with one untitled tab, then exercise the chain from a second process. On Windows the easiest launcher is the dev binary itself; on Linux/Mac use the OS shell. Use the temp dir `C:\Users\ruben\AppData\Local\Temp\opencode` for smoke files (pre-approved for external access).

**Sub-test 4a — second launch with a file arg (happy path):**
1. Create `C:\Users\ruben\AppData\Local\Temp\opencode\smoke-a.txt` with some content.
2. From a separate terminal, launch a second klad process pointing at it. On Windows: `cargo run --manifest-path src-tauri\Cargo.toml -- C:\Users\ruben\AppData\Local\Temp\opencode\smoke-a.txt` (quote the path if it contains spaces). Alternatively, double-click the file in Explorer if `.txt` is bound to klad.
3. Verify: the **existing** klad window comes to the front (unminimize → show → focus), `smoke-a.txt` opens as a new tab, **no second window** appears.

**Sub-test 4b — second launch with a different file:**
1. Create `C:\Users\ruben\AppData\Local\Temp\opencode\smoke-b.md` with markdown content.
2. Launch a second process pointing at it.
3. Verify: existing window raises again; `smoke-b.md` opens as a second new tab and the preview pane activates (markdown). Two named tabs now visible.

**Sub-test 4c — second launch with no args:**
1. Launch a second process with no argv (`cargo run --manifest-path src-tauri\Cargo.toml` with no trailing path).
2. Verify: existing window raises; **no new tab** appears; no second window. (`extractPaths` returned `[]`, handler no-op'd.)

**Sub-test 4d — second launch with already-open file (dedup):**
1. Launch a second process pointing at `smoke-a.txt` again.
2. Verify: existing window raises; the existing `smoke-a.txt` tab becomes active (no duplicate tab, no re-read prompt) — this is `openPath`'s `findTabByPath` dedup path.

**Sub-test 4e — second launch with a missing path:**
1. Launch a second process pointing at a path that doesn't exist (e.g. `C:\nonexistent\ghost.txt`).
2. Verify: existing window raises; a `showError` dialog appears reading "Could not open file: …" — this is `openPath`'s `catch (e)` branch; the listener itself didn't crash.

**Sub-test 4f — second launch during shutdown prompt (known quirk, spec §6):**
1. In the running klad, dirty a tab, then initiate close (window X or menu Exit) so `onCloseRequested` fires and shows the `askSave` dialog.
2. While the `askSave` dialog is up, launch a second process pointing at a new file.
3. Verify: the new file's tab is visible alongside the dialog. Per spec §6 this is an accepted v1 quirk — Save/Discard destroys the new tab with the window; Cancel leaves the new tab open beside the resolved prompt. Document the observed behavior in the commit message if it deviates.

**Sub-test 4g — session survives the cycle:**
1. Quit klad cleanly (resolve any prompts).
2. Re-launch `npm run tauri dev`.
3. Verify: session restore brings back the named tabs from 4a/4b (`smoke-a.txt`, `smoke-b.md`) — confirms the single-writer `localStorage` discipline survived and there was no race with a second process on shutdown.

- [ ] **Step 5: Commit**

```bash
git add src/fileio.ts src/main.ts
git commit -m "feat(single-instance): wire forwarded paths into openPath

Adds listenOpenFile wrapper over @tauri-apps/api/event's listen() and
registers it at the top of the bootstrap IIFE (before getStartupFile's
first await) so a forwarded file arriving during restore is captured.
openPath's existing dedup handles late arrivals safely. No new npm dep
(event module ships inside the already-installed @tauri-apps/api).

Completes the single-instance chain: second process forwards argv,
exits; first instance opens the file as a new tab and raises.

Spec: docs/artifacts/specs/single-instance/2026-07-18-single-instance-design.md"
```

---

## Verification summary (run before declaring the plan done)

- `cd src-tauri && cargo build` — clean.
- `cd src-tauri && cargo test` — all green (regression gate; no new Rust tests).
- `npm run build` — clean.
- `npm test` — all green (including new `extractPaths` tests).
- Manual smoke 4a–4g above — behavior matches spec §6.

## Catalog self-check (per AGENTS.md "Adding features")

After all three tasks, `git diff main...feat/tabs-and-session-restore --stat` (limited to this plan's commits) should touch exactly:

- `src-tauri/Cargo.toml` (+1 dep line)
- `src-tauri/Cargo.lock` (regenerated by `cargo build`)
- `src-tauri/src/main.rs` (plugin chain + `Payload` struct + 3 imports)
- `src-tauri/capabilities/default.json` (+3 permissions)
- `src/fileio.ts` (+1 event import, +`extractPaths`, +`listenOpenFile`)
- `src/__tests__/singleinstance.test.ts` (new file)
- `src/main.ts` (+1 named import, +5 lines in the bootstrap IIFE)

It must **not** touch: `src-tauri/src/fs_cmds.rs`, the `invoke_handler![...]` list contents inside `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`, `package.json`, `index.html`, or any of `src/{tabs,session,tabbar,document,editor,statusbar,preview,render,settings,dialogs}.ts`, `src/styles.css`. If the diff shows any of those, stop and reconcile against spec §5/§7 before committing further.

## Spec coverage cross-check

| Spec section | Covered by |
|---|---|
| §2 Goals: forward file arg → new tab + raise + exit | Task 1 (emit + raise + exit inside plugin), Task 3 (openPath consumer) |
| §2 Goals: no-arg launch → raise only | Task 2 `extractPaths` returns `[]` when argv is `["klad"]` or empty → Task 3 handler no-ops; Task 1 still raises the window |
| §2 Goals: first-launch unchanged | File Structure "Untouched" list + Catalog self-check |
| §2 Goals: single localStorage writer | Inherent to single-instance semantics; verified by smoke 4g |
| §3 Approach (plugin callback emits + raises) | Task 1 Step 2 |
| §4 Data flow diagram | Matches Task 1 Step 2 (Rust) + Task 3 Step 2 (frontend) |
| §5 Event payload contract (`{argv, cwd}`, `#[derive(Serialize)]`, private) | Task 1 Step 2 (`Payload` struct) + Task 2 Step 3 (`extractPaths` validation) |
| §6 Behaviors (mid-restore, mid-shutdown, missing path, dedup, race) | Smoke 4a–4f |
| §7 Catalog updates table | Catalog self-check above |
| §8 Testing strategy (build + cargo test + smoke; pure logic = none new) | Task 1 Step 4 (cargo), Task 2 (vitest for `extractPaths`), Task 3 Step 4 (smoke) |
| §9 Open issues | None (resolved in spec) |
