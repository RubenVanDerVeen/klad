# Workspace / Folder Mode — Implementation Plan

**Spec:** `docs/artifacts/features/workspace/2026-09-30-workspace-folder-mode-design.md` (read this first — it holds the confirmed decisions, the superseded-boundary note, and the data-flow trace).

**Branch:** `feat/workspace` (Conventional Branch, cut from default).

**Versioning:** project is versioned; canonical `src-tauri/tauri.conf.json`. Expected bump at close-out: **minor, 0.6.0 → 0.7.0** (new backward-compatible functionality), synced to `package.json` + `src-tauri/Cargo.toml` and `CHANGELOG.md` by the documenter at close-out.

**Conventions for every task:** TDD (failing test first), Conventional Commits (`feat(scope): …` / `docs: …`), bundle each task's related changes into its single commit. Frontend check: `npm test` and `npx tsc --noEmit`. Backend check: `cd src-tauri && cargo test`. Where an anchor says "follow the file's existing style/imports", the executor reads the file first and adapts names — but the **behavior and public signatures in each `Interfaces: Produces` block are fixed contracts**; do not rename them.

---

## File Structure (who owns what)

| File | Task | Responsibility |
|---|---|---|
| `src-tauri/src/fs_cmds.rs` | 1 | `DirEntry` + `list_dir` command + tests |
| `src-tauri/src/main.rs` | 1 | register `list_dir` |
| `src-tauri/src/typst_compile.rs` | 2 | project-root `World`, new `compile_typst` signature, `TypstError.file`, tests |
| `src/workspace.ts` (+test) | 3 | workspace persistence + pure path/override helpers |
| `src/tree.ts` (+test) | 3 | imperative sidebar tree DOM + pure entry helpers |
| `src/fileio.ts` | 4 | `listDir` + `compileTypst` wrappers, `DirEntry`/`TypstError` types |
| `src/preview.ts` (+`src/__tests__/typst-preview.test.ts`) | 4 | `setTypstProjectProvider`, compile args, error banner with `file` |
| `index.html`, `src/styles.css`, `src/menu.ts`, `src/main.ts` | 5 | sidebar UI, menu items, folder open/close/restore wiring |
| `README.md`, `CHANGELOG.md`, `AGENTS.md` | 6 | catalogs |

Wave 1 (parallel): Tasks 1, 2, 3. Wave 2: Task 4. Wave 3: Task 5. Wave 4: Task 6.

---

### Task 1: `list_dir` command (Rust)

**Files:**
- Modify: `src-tauri/src/fs_cmds.rs` (new `DirEntry` struct + `list_dir` fn + tests; existing `read_file`/`save_file` untouched)
- Modify: `src-tauri/src/main.rs:32-37` (`generate_handler!` list — add `fs_cmds::list_dir`)

**Depends:** none

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: Tauri command `list_dir(path: String) -> Result<Vec<DirEntry>, String>`; `DirEntry { name: String, path: String, is_dir: bool }` serialized **camelCase** (`isDir` for TypeScript). Tasks 4–5 consume this shape verbatim.

- [ ] **Step 1: Write the failing tests**

In `fs_cmds.rs`, locate the existing `#[cfg(test)] mod tests` (recon: tests live at `fs_cmds.rs:119-282`). **No new dependencies:** the crate has no `[dev-dependencies]`; existing tests build temp fixture dirs with `std::env::temp_dir()` + pid-named helper + manual `remove_dir_all` (see `typst_compile.rs` tests for the pattern). Reuse that pattern: if `fs_cmds.rs` tests already have such a helper, call it; otherwise port the helper from `typst_compile.rs`'s test module (unique tag per test, same cleanup idiom). Add inside the test module:

```rust
#[test]
fn list_dir_sorts_dirs_first_and_skips_dotfiles() {
    let root = fixture_dir("ws_list_dir"); // the file's existing temp-dir helper, ported if absent
    std::fs::create_dir_all(root.join("b_dir")).unwrap();
    std::fs::create_dir_all(root.join("a_dir")).unwrap();
    std::fs::write(root.join("B.txt"), "b").unwrap();
    std::fs::write(root.join("a.txt"), "a").unwrap();
    std::fs::write(root.join(".hidden"), "h").unwrap();

    let entries = list_dir(root.to_string_lossy().into_owned()).unwrap();
    let names: Vec<(bool, String)> = entries
        .iter()
        .map(|e| (e.is_dir, e.name.clone()))
        .collect();
    assert_eq!(
        names,
        vec![
            (true, "a_dir".to_string()),
            (true, "b_dir".to_string()),
            (false, "a.txt".to_string()),
            (false, "B.txt".to_string()),
        ]
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn list_dir_missing_dir_is_error() {
    assert!(list_dir("/definitely/not/hereklad".into()).is_err());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test list_dir` (in `src-tauri/`)
Expected: FAIL — `cannot find function list_dir` (compile error).

- [ ] **Step 3: Implement**

Add to `fs_cmds.rs` (follow the file's existing `Serialize` import style — extend the existing `use` rather than duplicating):

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

// ponytail: no ignore-file/.gitignore support; dotfile skip only. Add ignore awareness if big build dirs annoy.
#[tauri::command(async)]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let reader = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out: Vec<DirEntry> = Vec::new();
    for entry in reader {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().map_err(|e| e.to_string())?.is_dir();
        out.push(DirEntry {
            path: entry.path().to_string_lossy().into_owned(),
            name,
            is_dir,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}
```

Register in `main.rs` inside `tauri::generate_handler![...]` (recon `main.rs:32-37`):

```rust
.invoke_handler(tauri::generate_handler![
    fs_cmds::read_file,
    fs_cmds::save_file,
    fs_cmds::list_dir,
    fs_cmds::get_startup_file,
    typst_compile::compile_typst
])
```

- [ ] **Step 4: Run tests + full suite**

Run: `cargo test` (in `src-tauri/`)
Expected: all PASS (existing 17 + 2 new). Clean build, no warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/fs_cmds.rs src-tauri/src/main.rs
git commit -m "feat(fs): add list_dir command for workspace tree"
```

---

### Task 2: Project-root Typst world (Rust)

**Files:**
- Modify: `src-tauri/src/typst_compile.rs` (world struct + `compile_typst` signature + `format_diag` + tests). No other file.

**Depends:** none

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: Tauri command `compile_typst(text: String, path: Option<String>, root: Option<String>, overrides: std::collections::HashMap<String, String>) -> Result<TypstResult, String>` and `TypstError { message: String, line: Option<u32>, file: Option<String> }`. Task 4's TypeScript wrapper mirrors these exactly.

- [ ] **Step 0: Read before editing**

Read `typst_compile.rs` end to end. Verify against the typst 0.15.1 crate (as imported in this file; `cargo doc --open` or the checked-in source under `~/.cargo`) the exact spellings of: `VirtualRoot` variants (project-root variant — recon suggests `VirtualRoot::Project(PathBuf)`; the in-file precedent branch is `VirtualRoot::Package(spec)` at `:144-146`), `FileId::new` arguments, `Source::new`, `Bytes::new`, `VirtualPath::new`, and the `FileError` variant payloads (recon shows `FileError::NotFound(PathBuf)` — payloads differ from older typst; match this crate's reality). If any spelling below differs, adapt the spelling, **not** the behavior.

- [ ] **Step 1: Rewrite the boundary test + add new tests (failing)**

In the `#[cfg(test)] mod tests` (`:232-354`): **delete** `include_is_clean_error_in_v1` (`:335`) and add the following. Temp dirs use the file's **existing** fixture helper (pid-named dir under `std::env::temp_dir()`, manual `remove_dir_all` cleanup — match the existing tests' exact helper name and cleanup idiom; `fixture_dir(tag)` below stands for it and returns a `PathBuf`; unique tag per test). **No new dependencies.**

```rust
fn write_file(root: &std::path::Path, rel: &str, content: &str) {
    let p = root.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(&p, content).unwrap();
}
```

```rust
#[test]
fn imports_error_without_root() {
    // preserves old v1 coverage (was: include_is_clean_error_in_v1)
    let result = compile_with(
        "#import \"other.typ\": x\n#x",
        None, None, std::collections::HashMap::new(),
    );
    assert!(!result.errors.is_empty());
}

#[test]
fn project_imports_resolve_across_files() {
    let root = fixture_dir("ws_project_imports");
    write_file(&root, "lib.typ", "#let greeting = [hello]");
    write_file(&root, "ch1/main.typ", "#import \"../lib.typ\": greeting\n#greeting");
    let result = compile_with(
        "#import \"../lib.typ\": greeting\n#greeting",
        Some(root.join("ch1/main.typ").to_string_lossy().into_owned()),
        Some(root.to_string_lossy().into_owned()),
        std::collections::HashMap::new(),
    );
    let _ = std::fs::remove_dir_all(&root);
    assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
    assert_eq!(result.pages.len(), 1);
}

#[test]
fn dirty_override_wins_over_disk() {
    let root = fixture_dir("ws_dirty_override");
    // disk copy is broken; override supplies valid text -> compile succeeds only if override used
    write_file(&root, "lib.typ", "#let greeting = ");
    write_file(&root, "main.typ", "#import \"lib.typ\": greeting\n#greeting");
    let mut overrides = std::collections::HashMap::new();
    overrides.insert("lib.typ".to_string(), "#let greeting = [hi]".to_string());
    let result = compile_with(
        "#import \"lib.typ\": greeting\n#greeting",
        Some(root.join("main.typ").to_string_lossy().into_owned()),
        Some(root.to_string_lossy().into_owned()),
        overrides,
    );
    let _ = std::fs::remove_dir_all(&root);
    assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
}

#[test]
fn missing_import_stays_clean_error() {
    let root = fixture_dir("ws_missing_import");
    let result = compile_with(
        "#import \"nope.typ\": x\n#x",
        Some(root.join("main.typ").to_string_lossy().into_owned()),
        Some(root.to_string_lossy().into_owned()),
        std::collections::HashMap::new(),
    );
    let _ = std::fs::remove_dir_all(&root);
    assert!(!result.errors.is_empty());
    assert!(result.errors[0].message.contains("nope.typ"), "msg: {}", result.errors[0].message);
}

#[test]
fn error_in_imported_file_carries_file() {
    let root = fixture_dir("ws_error_file");
    write_file(&root, "lib.typ", "#assert(false)");
    write_file(&root, "main.typ", "#import \"lib.typ\"\n");
    let result = compile_with(
        "#import \"lib.typ\"\n",
        Some(root.join("main.typ").to_string_lossy().into_owned()),
        Some(root.to_string_lossy().into_owned()),
        std::collections::HashMap::new(),
    );
    let _ = std::fs::remove_dir_all(&root);
    assert!(!result.errors.is_empty());
    assert_eq!(result.errors[0].file.as_deref(), Some("lib.typ"));
    assert_eq!(result.errors[0].line, Some(1));
}

#[test]
fn entry_outside_root_falls_back_to_detached() {
    let root = fixture_dir("ws_outside_root");
    let elsewhere = fixture_dir("ws_outside_elsewhere");
    write_file(&root, "lib.typ", "#let greeting = [hi]");
    let result = compile_with(
        "#import \"lib.typ\": greeting\n#greeting",
        Some(elsewhere.join("main.typ").to_string_lossy().into_owned()),
        Some(root.to_string_lossy().into_owned()),
        std::collections::HashMap::new(),
    );
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&elsewhere);
    assert!(!result.errors.is_empty(), "entry outside root must behave as detached");
}

#[test]
fn project_file_resolves_binary_asset() {
    let root = fixture_dir("ws_binary_asset");
    write_file(&root, "tiny.svg",
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><rect width=\"10\" height=\"10\" fill=\"red\"/></svg>");
    let result = compile_with(
        "#image(\"tiny.svg\")",
        Some(root.join("main.typ").to_string_lossy().into_owned()),
        Some(root.to_string_lossy().into_owned()),
        std::collections::HashMap::new(),
    );
    let _ = std::fs::remove_dir_all(&root);
    assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
    assert_eq!(result.pages.len(), 1);
}
```

`compile_with` is a test-support wrapper that builds the world exactly as the command does (the existing tests already construct `SingleFileWorld` directly — extend that existing helper; if the current helper is `fn compile(text: &str) -> TypstResult`, add the three extra params with defaults at existing call sites, keeping old call sites compiling by passing `None, None, HashMap::new()`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test` (in `src-tauri/`)
Expected: FAIL — `compile_with` undefined / wrong arity / `file` field missing (compile errors), plus behavioral failures once compiling.

- [ ] **Step 3: Implement**

**3a. Signature + types:**

```rust
#[derive(serde::Serialize, Clone)]
pub struct TypstError {
    pub message: String,
    pub line: Option<u32>,
    pub file: Option<String>,
}

#[tauri::command(async)]
pub fn compile_typst(
    text: String,
    path: Option<String>,
    root: Option<String>,
    overrides: std::collections::HashMap<String, String>,
) -> Result<TypstResult, String>
```

**3b. World fields:** add to `SingleFileWorld`: `overrides: std::collections::HashMap<String, String>` and (if the typst `VirtualRoot` project variant does not itself carry the root path — check Step 0) `project_root: Option<std::path::PathBuf>`.

**3c. Entry id:** where the world is built, replace `Source::detached(text)` (`:63`) with a nested match (guard `if let` is not legal in match arms on stable Rust — use nested `match`/`if let`):

```rust
let (entry_id, entry_source) = match (path.as_deref(), root.as_deref()) {
    (Some(p), Some(r)) => match rel_path_under(r, p) {
        Some(rel) => {
            let vpath = typst::syntax::VirtualPath::new(std::path::Path::new(&rel));
            // adapt: construct the project-rooted FileId per Step 0 findings,
            // e.g. FileId::new(Some(VirtualRoot::Project(root_abs)), vpath)
            // MUST use the same root value for every project file the world serves.
            let id = make_project_file_id(r, vpath);
            (id, typst::syntax::Source::new(id, text))
        }
        None => (detached_id_as_today, typst::syntax::Source::detached(text)),
    },
    _ => (detached_id_as_today, typst::syntax::Source::detached(text)),
};
```

`rel_path_under(root, path) -> Option<String>` — component-wise prefix test, forward-slash output (accept `\` and `/` in inputs):

```rust
fn rel_path_under(root: &str, path: &str) -> Option<String> {
    let norm = |p: &str| p.replace('\\', "/");
    let r = norm(root).trim_end_matches('/').to_string();
    let p = norm(path).trim_end_matches('/').to_string();
    if !p.starts_with(&format!("{r}/")) { return None; }
    Some(p[r.len() + 1..].to_string())
}
```

**3d. `source()` project branch** (alongside the existing package branch, `:132-161`): if the id's root is the project root → `let rel = id.vpath().get_with_slash();` → if `let Some(text) = self.overrides.get(&rel)` → `Ok(Source::new(id, text.clone()))` → else `std::fs::read_to_string(root.join(id.vpath()))` mapped to `Source::new(id, text)`. Map io errors via a new helper:

```rust
fn map_file_error(e: std::io::Error) -> typst::diag::FileError {
    use typst::diag::FileError;
    match e.kind() {
        std::io::ErrorKind::NotFound => FileError::NotFound(/* payload per this crate's variant */),
        std::io::ErrorKind::PermissionDenied => FileError::AccessDenied,
        _ if e.to_string().contains("stream did not contain valid UTF-8") => FileError::InvalidUtf8, // or the crate's utf-8 variant name per Step 0
        _ => FileError::Other(Some(e.into())), // adapt payload to the crate's variant shape
    }
}
```

**3e. `file()` project branch:** same id-root check → `std::fs::read(root.join(id.vpath())).map(|b| Ok(typst::foundations::Bytes::new(b))).map_err(map_file_error)?` (import path of `Bytes` per the file's existing imports; if the file already imports `Bytes`, reuse).

**3f. `format_diag`** (`:182`): populate `file` from the diagnostic's span — resolve the span's source id via the world (`WorldExt::source(diag.span)` or equivalent; if the id's vpath equals the entry's vpath it is still reported — always set `file` when it resolves), `file: Some(id.vpath().get_with_slash())`.

- [ ] **Step 4: Run tests + full suite**

Run: `cargo test` (in `src-tauri/`)
Expected: all PASS — the 6 new tests above, `imports_error_without_root`, and the pre-existing package tests (`imports_local_package`, `missing_package_is_clean_error`, `compiles_trivial_doc`, `returns_errors_for_broken_doc`) all green. `main.rs` needs **no** change (command name unchanged — args are additive).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/typst_compile.rs
git commit -m "feat(typst): resolve imports against workspace root with dirty-buffer overlay"
```

---

### Task 3: `workspace.ts` + `tree.ts` (frontend pure modules)

**Files:**
- Create: `src/workspace.ts`
- Create: `src/tree.ts`
- Create: `src/__tests__/workspace.test.ts`
- Create: `src/__tests__/tree.test.ts`

**Depends:** none

**Interfaces:**
- Consumes: nothing (deliberately IPC-free — the tree receives a `listDir` function by injection so this task is testable and parallel with Tasks 1–2).
- Produces (Task 5 consumes all verbatim):
  - `workspace.ts`: `interface WorkspaceState { root: string }`, `loadWorkspace(): WorkspaceState | null`, `saveWorkspace(root: string): void`, `clearWorkspace(): void`, `relPathUnder(root: string, path: string): string | null`, `collectOverrides(entries: OverrideEntry[], root: string, excludePath?: string): Record<string, string>`, `interface OverrideEntry { path: string | null; dirty: boolean; text: string }`
  - `tree.ts`: `interface TreeEntry { name: string; path: string; isDir: boolean }`, `interface TreeHooks { onOpen(path: string): void; listDir(path: string): Promise<TreeEntry[]> }`, `initTree(hooks: TreeHooks): void`, `renderTreeRoot(root: string): Promise<void>`, `clearTree(): void`, `sortEntries(entries: TreeEntry[]): TreeEntry[]`, `visibleEntries(entries: TreeEntry[]): TreeEntry[]`

- [ ] **Step 1: Write failing tests**

`src/__tests__/workspace.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  collectOverrides, relPathUnder, parseWorkspace,
  saveWorkspace, clearWorkspace, loadWorkspace,
} from "../workspace";

describe("parseWorkspace", () => {
  it("accepts {root}", () => {
    expect(parseWorkspace(JSON.stringify({ root: "/tmp/p" }))).toEqual({ root: "/tmp/p" });
  });
  it("rejects junk", () => {
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace("{")).toBeNull();
    expect(parseWorkspace(JSON.stringify({ root: 3 }))).toBeNull();
    expect(parseWorkspace(JSON.stringify({}))).toBeNull();
  });
});

describe("relPathUnder", () => {
  it("returns forward-slash relpath", () => {
    expect(relPathUnder("/a/b", "/a/b/c/d.typ")).toBe("c/d.typ");
  });
  it("normalizes windows separators", () => {
    expect(relPathUnder("C:\\proj", "C:\\proj\\sub\\l.typ")).toBe("sub/l.typ");
  });
  it("null outside root and for root itself", () => {
    expect(relPathUnder("/a/b", "/a/x/d.typ")).toBeNull();
    expect(relPathUnder("/a/b", "/a/b")).toBeNull();
    expect(relPathUnder("/a/b", "/a/b2/c.typ")).toBeNull();
  });
});

describe("collectOverrides", () => {
  const root = "/r";
  it("takes dirty files under root, excludes active", () => {
    expect(collectOverrides([
      { path: "/r/lib.typ", dirty: true, text: "live" },
      { path: "/r/clean.typ", dirty: false, text: "stale" },
      { path: "/r/main.typ", dirty: true, text: "entry" },
      { path: "/elsewhere/x.typ", dirty: true, text: "out" },
      { path: null, dirty: true, text: "untitled" },
    ], root, "/r/main.typ")).toEqual({ "lib.typ": "live" });
  });
});

describe("localStorage round-trip", () => {
  beforeEach(() => localStorage.clear());
  it("saves, loads, clears", () => {
    saveWorkspace("/w");
    expect(loadWorkspace()).toEqual({ root: "/w" });
    clearWorkspace();
    expect(loadWorkspace()).toBeNull();
  });
});
```

`src/__tests__/tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sortEntries, visibleEntries, TreeEntry } from "../tree";

const e = (name: string, isDir: boolean): TreeEntry => ({ name, path: `/${name}`, isDir });

describe("sortEntries", () => {
  it("dirs first, case-insensitive", () => {
    expect(sortEntries([e("B.txt", false), e("zdir", true), e("a.txt", false), e("Adir", true)])
      .map((x) => x.name)).toEqual(["Adir", "zdir", "a.txt", "B.txt"]);
  });
});

describe("visibleEntries", () => {
  it("drops dotfiles", () => {
    expect(visibleEntries([e(".git", true), e("main.typ", false)]).map((x) => x.name))
      .toEqual(["main.typ"]);
  });
});
```

*(If existing DOM-touching tests in `src/__tests__/` configure jsdom per-file, match whatever pattern `src/__tests__` already uses; these two files are pure — no DOM needed.)*

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../workspace`, `../tree`.

- [ ] **Step 3: Implement**

`src/workspace.ts` (pattern: `src/session.ts` / `src/settings.ts` — same key style):

```ts
const KEY = "klad-workspace";

export interface WorkspaceState {
  root: string;
}

export function parseWorkspace(raw: string | null): WorkspaceState | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && typeof (v as { root?: unknown }).root === "string"
        && (v as { root: string }).root !== "") {
      return { root: (v as { root: string }).root };
    }
  } catch {
    /* invalid JSON -> null */
  }
  return null;
}

export function loadWorkspace(): WorkspaceState | null {
  return parseWorkspace(localStorage.getItem(KEY));
}

export function saveWorkspace(root: string): void {
  localStorage.setItem(KEY, JSON.stringify({ root }));
}

export function clearWorkspace(): void {
  localStorage.removeItem(KEY);
}

/** Forward-slash relpath of `path` under `root`; null when outside (or equal to root). */
export function relPathUnder(root: string, path: string): string | null {
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!p.startsWith(`${r}/`)) return null;
  return p.slice(r.length + 1);
}

export interface OverrideEntry {
  path: string | null;
  dirty: boolean;
  text: string;
}

export function collectOverrides(
  entries: OverrideEntry[],
  root: string,
  excludePath?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.dirty || entry.path === null || entry.path === excludePath) continue;
    const rel = relPathUnder(root, entry.path);
    if (rel !== null) out[rel] = entry.text;
  }
  return out;
}
```

`src/tree.ts` (pattern: `src/tabbar.ts` — imperative DOM, module-level state; requires `#sidebar-title` / `#tree` elements that Task 5 adds — functions no-op when absent):

```ts
export interface TreeEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface TreeHooks {
  onOpen(path: string): void;
  listDir(path: string): Promise<TreeEntry[]>;
}

let hooks: TreeHooks | null = null;

export function initTree(h: TreeHooks): void {
  hooks = h;
}

export function clearTree(): void {
  document.getElementById("tree")?.replaceChildren();
}

export function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0;
  });
}

export function visibleEntries(entries: TreeEntry[]): TreeEntry[] {
  return entries.filter((e) => !e.name.startsWith("."));
}

const basename = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

export async function renderTreeRoot(root: string): Promise<void> {
  const title = document.getElementById("sidebar-title");
  const tree = document.getElementById("tree");
  if (!tree) return;
  if (title) title.textContent = basename(root);
  tree.replaceChildren();
  const row = rowFor({ name: basename(root), path: root, isDir: true }, 0);
  row.classList.add("tree-root");
  tree.append(row);
  await toggleDir(row, root, 0); // start expanded
}

function rowFor(entry: TreeEntry, depth: number): HTMLElement {
  const row = document.createElement("div");
  row.className = entry.isDir ? "tree-row tree-dir" : "tree-row tree-file";
  row.dataset.name = entry.name;
  row.dataset.path = entry.path;
  row.style.paddingLeft = `${8 + depth * 14}px`;
  row.textContent = entry.isDir ? `▸ ${entry.name}` : entry.name;
  if (entry.isDir) row.addEventListener("click", () => void toggleDir(row, entry.path, depth));
  else row.addEventListener("click", () => hooks?.onOpen(entry.path));
  return row;
}

// ponytail: no caching, no fs watching — every expand re-lists, external changes self-heal.
async function toggleDir(row: HTMLElement, path: string, depth: number): Promise<void> {
  if (!hooks) return;
  let box = row.nextElementSibling as HTMLElement | null;
  if (row.dataset.open === "true") {
    row.dataset.open = "false";
    row.textContent = `▸ ${row.dataset.name}`;
    box?.remove();
    return;
  }
  row.dataset.open = "true";
  row.textContent = `▾ ${row.dataset.name}`;
  if (!box) {
    box = document.createElement("div");
    row.after(box);
  }
  box.replaceChildren(Object.assign(document.createElement("div"), { className: "tree-row tree-error", textContent: "…" }));
  try {
    const entries = sortEntries(visibleEntries(await hooks.listDir(path)));
    box.replaceChildren(...entries.map((e) => rowFor(e, depth + 1)));
  } catch {
    box.replaceChildren(Object.assign(document.createElement("div"), { className: "tree-row tree-error", textContent: "cannot list" }));
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS (new suites + all existing), clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/workspace.ts src/tree.ts src/__tests__/workspace.test.ts src/__tests__/tree.test.ts
git commit -m "feat(workspace): add workspace state and sidebar tree modules"
```

---

### Task 4: IPC wrappers + preview wiring

**Files:**
- Modify: `src/fileio.ts` (extend `compileTypst`, add `listDir`, extend `DirEntry`/`TypstError`-related types)
- Modify: `src/preview.ts` (provider state, compile args, error banner `file:line:`)
- Modify: `src/__tests__/typst-preview.test.ts` (args tests)

**Depends:** Task 1, Task 2 (the Rust command signatures these wrappers mirror)

**Interfaces:**
- Consumes: `list_dir(path) -> DirEntry[]{name, path, isDir}` (Task 1) and `compile_typst(text, path, root, overrides) -> TypstResult{pages, errors: TypstError[]}` with `TypstError{message, line, file}` (Task 2).
- Produces (Task 5 consumes verbatim): `fileio.ts`: `interface DirEntry { name: string; path: string; isDir: boolean }`, `listDir(path: string): Promise<DirEntry[]>`, `compileTypst(text: string, path: string | null, root: string | null, overrides: Record<string, string>): Promise<TypstResult>`; `preview.ts`: `interface TypstProject { path: string | null; root: string | null; overrides: Record<string, string> }`, `setTypstProjectProvider(fn: (() => TypstProject | null) | null): void`, `typstCompileArgs(text: string, proj: TypstProject | null): [string, string | null, string | null, Record<string, string>]`.

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/typst-preview.test.ts` (match its existing imports; add `typstCompileArgs` to the `../preview` import — `setTypstProjectProvider` stays exported for Task 5 but needs no test here; it is a trivial setter and the wiring is covered by Task 5's manual smoke):

```ts
describe("typstCompileArgs", () => {
  it("legacy args when no project", () => {
    expect(typstCompileArgs("body", null)).toEqual(["body", null, null, {}]);
  });
  it("full args from provider snapshot", () => {
    expect(typstCompileArgs("body", { path: "/r/m.typ", root: "/r", overrides: { "lib.typ": "x" } }))
      .toEqual(["body", "/r/m.typ", "/r", { "lib.typ": "x" }]);
    expect(typstCompileArgs("body", { path: null, root: null, overrides: {} }))
      .toEqual(["body", null, null, {}]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `typstCompileArgs` / `setTypstProjectProvider` not exported.

- [ ] **Step 3: Implement**

`src/fileio.ts` — extend the existing Typst types and wrappers (keep every existing export; `FileDoc` etc. untouched):

```ts
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export function listDir(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", { path });
}

// TypstError gains `file` (matches Rust TypstError from Task 2):
export interface TypstError {
  message: string;
  line: number | null;
  file: string | null;
}

export function compileTypst(
  text: string,
  path: string | null,
  root: string | null,
  overrides: Record<string, string>,
): Promise<TypstResult> {
  return invoke<TypstResult>("compile_typst", { text, path, root, overrides });
}
```

*(If `TypstError`/`TypstResult` currently live in `preview.ts` rather than `fileio.ts`, extend them where they live and keep one canonical declaration — do not duplicate.)*

`src/preview.ts`:

```ts
export interface TypstProject {
  path: string | null;
  root: string | null;
  overrides: Record<string, string>;
}

let typstProjectProvider: (() => TypstProject | null) | null = null;

/** Mirrors setPreviewBaseDir, but function-valued: every compile reads fresh tab state. */
export function setTypstProjectProvider(fn: (() => TypstProject | null) | null): void {
  typstProjectProvider = fn;
}

export function typstCompileArgs(
  text: string,
  proj: TypstProject | null,
): [string, string | null, string | null, Record<string, string>] {
  return [text, proj?.path ?? null, proj?.root ?? null, proj?.overrides ?? {}];
}
```

In the typst render path (where `compileTypst(text)` is invoked today, recon `preview.ts:109`), change to:

```ts
const proj = typstProjectProvider?.() ?? null;
const result = await compileTypst(...typstCompileArgs(text, proj));
```

Error banner: where the typst error text is composed today (the `#preview-error` fill, recon `preview.ts:63-94`), prefix `file` when present, keeping the existing message/line format:

```ts
const filePrefix = err.file ? `${err.file}:` : "";
// e.g. `${filePrefix}${err.line ?? ""} ${err.message}` — adapt to the file's existing line formatting
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all PASS, clean typecheck. (`compileTypst` call sites: only `preview.ts` — recon-verified.)

- [ ] **Step 5: Commit**

```bash
git add src/fileio.ts src/preview.ts src/__tests__/typst-preview.test.ts
git commit -m "feat(preview): pass workspace project context to typst compile"
```

---

### Task 5: Sidebar UI + menu + wiring

**Files:**
- Modify: `index.html` (sidebar aside inside `#content`, before `#editor`)
- Modify: `src/styles.css` (sidebar + tree styles)
- Modify: `src/menu.ts` (two File items + `MenuActions` fields)
- Modify: `src/main.ts` (workspace state, open/close/restore, tree init, provider wiring)

**Depends:** Task 3, Task 4 (and transitively 1–2)

**Interfaces:**
- Consumes: `initTree`, `renderTreeRoot`, `clearTree` (Task 3); `loadWorkspace`, `saveWorkspace`, `clearWorkspace`, `collectOverrides` (Task 3); `listDir`, `compileTypst`-provider plumbing + `setTypstProjectProvider`, `TypstProject` (Task 4); existing `openPath` (`main.ts:308`), `applyPreviewMode` (`main.ts:193`), runtime tab list (`main.ts:46-48`), `getText` (`src/editor.ts`).
- Produces: complete user-facing feature (no further code tasks consume this).

- [ ] **Step 1: Markup + styles**

`index.html` — inside `<main id="content">`, immediately before `<div id="editor">`:

```html
<aside id="sidebar" hidden>
  <div id="sidebar-title"></div>
  <div id="tree"></div>
</aside>
```

`src/styles.css` — append (reuse the file's existing CSS custom property names from the `:root`/`[data-theme="dark"]` blocks at `styles.css:1-25` for border/hover colors where equivalents exist; literals below are fallbacks):

```css
#sidebar {
  flex: none;
  width: 220px;
  overflow-y: auto;
  border-right: 1px solid var(--border, #ccc);
  padding: 4px 0;
}
#sidebar[hidden] { display: none; }
#sidebar-title {
  font-weight: 600;
  padding: 4px 8px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tree-row {
  padding-top: 2px;
  padding-bottom: 2px;
  padding-right: 8px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}
.tree-row:hover { background: var(--hover, rgba(127, 127, 127, 0.15)); }
.tree-dir { font-weight: 500; }
.tree-root { font-weight: 600; }
.tree-error { opacity: 0.6; font-style: italic; cursor: default; }
.tree-error:hover { background: none; }
```

- [ ] **Step 2: Menu**

`src/menu.ts` — add to `MenuActions` (`menu.ts:9-29`):

```ts
onOpenFolder(): void;
onCloseFolder(): void;
```

In the File submenu construction (after the existing "Open…" item, `menu.ts:45`), add two items with labels `Open Folder…` and `Close Folder` wired to `actions.onOpenFolder` / `actions.onCloseFolder`, following exactly how the existing "Open…" item is declared in this file (same object shape).

- [ ] **Step 3: Wire main.ts**

Extend imports (`open as openDialog` already imported for `doOpen`):

```ts
import { listDir } from "./fileio";
import { loadWorkspace, saveWorkspace, clearWorkspace, collectOverrides, OverrideEntry } from "./workspace";
import { initTree, renderTreeRoot, clearTree } from "./tree";
import { setTypstProjectProvider, TypstProject } from "./preview";
```

Module state + helpers (place near the other state; `views` = the runtime tab array at `main.ts:46-48`, `activeId` its active-tab id — use the file's actual names):

```ts
let workspaceRoot: string | null = null;

function currentTypstProject(): TypstProject {
  const active = views.find((v) => v.id === activeId);
  const path = active?.meta.path ?? null;
  const entries: OverrideEntry[] = views.map((v) => ({
    path: v.meta.path,
    dirty: v.meta.dirty,
    text: getText(v.view),
  }));
  const overrides = workspaceRoot ? collectOverrides(entries, workspaceRoot, path ?? undefined) : {};
  return { path, root: workspaceRoot, overrides };
}

function refreshTypstProvider(): void {
  setTypstProjectProvider(workspaceRoot ? currentTypstProject : null);
}

async function openFolder(): Promise<void> {
  const dir = await openDialog({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  workspaceRoot = dir;
  saveWorkspace(dir);
  document.getElementById("sidebar")?.removeAttribute("hidden");
  await renderTreeRoot(dir);
  refreshTypstProvider();
}

function closeFolder(): void {
  workspaceRoot = null;
  clearWorkspace();
  clearTree();
  document.getElementById("sidebar")?.setAttribute("hidden", "");
  refreshTypstProvider();
}
```

Call sites:
1. Bootstrap (after `initTree`): `initTree({ onOpen: openPath, listDir });`
2. Bootstrap, after `restoreSessionOrNew(...)` (`main.ts:493`):

```ts
const stored = loadWorkspace();
if (stored) {
  try {
    await listDir(stored.root); // dir still exists?
    workspaceRoot = stored.root;
    document.getElementById("sidebar")?.removeAttribute("hidden");
    await renderTreeRoot(stored.root);
    refreshTypstProvider();
  } catch {
    clearWorkspace(); // moved/deleted: forget it silently
  }
}
```

3. In `applyPreviewMode()` (`main.ts:193`) add `refreshTypstProvider();` — it already runs on every tab switch/open/save-as, which is exactly when `path` changes.
4. `setupMenu(...)` call site: add `onOpenFolder: () => void openFolder(),` and `onCloseFolder: () => closeFolder(),` to the actions object.

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit` → PASS, clean.
Run: `cd src-tauri && cargo test` → PASS (unchanged, sanity).
Manual smoke (`npm run tauri dev` or the project's dev script):
1. File > Open Folder… → pick a Typst project dir (e.g. `~/projects/Schoolprojects/Aardbei-Plukkers/docs/source/typst`) → sidebar shows tree with dirs first; click `.typ` files → open in tabs; preview renders the multi-file project.
2. Edit an imported file in a second tab without saving → active entry tab's preview reflects the edit (dirty overlay).
3. Break an import (`#import "nope.typ"`) → red banner names `nope.typ`; error in `lib.typ` → banner shows `lib.typ:<line>:`.
4. Collapse/expand a dir after touching it externally → re-lists fresh.
5. File > Close Folder → sidebar hides, single-file behavior returns.
6. Relaunch → workspace + tree restored; deleted root → silently cleared, app opens clean.

- [ ] **Step 5: Commit**

```bash
git add index.html src/styles.css src/menu.ts src/main.ts
git commit -m "feat(ui): workspace sidebar with file tree and folder menu"
```

---

### Task 6: Catalogs & docs

**Files:**
- Modify: `README.md` (feature mention in the feature list/overview where preview features are described)
- Modify: `CHANGELOG.md` (`[Unreleased]` → `### Added` entries)
- Modify: `AGENTS.md` (component table row)

**Depends:** Task 5

**Interfaces:**
- Consumes: the shipped behavior (Tasks 1–5).
- Produces: catalog parity per AGENTS.md "Adding features" rule. (No `package.json`/`Cargo.toml`/`tauri.conf.json`/`capabilities` changes — no new deps or scopes; the plan asserts this and Task 5's diff confirms it.)

- [ ] **Step 1: CHANGELOG.md** — under `[Unreleased]` → `### Added`:

```markdown
- Open Folder workspace (`File > Open Folder…`) with an interactive file-tree sidebar, remembered across sessions.
- Typst preview resolves project files: relative `#import`/`#include` and assets (e.g. `#image`) resolve against the opened folder, with unsaved changes in other tabs included live.
```

- [ ] **Step 2: README.md** — wherever Typst preview capabilities are listed, add one line: multi-file projects via Open Folder, imports and assets resolved against the folder.

- [ ] **Step 3: AGENTS.md** component table — add:

```markdown
| Workspace | `src/workspace.ts`, `src/tree.ts` | Folder root state, sidebar file tree |
```

- [ ] **Step 4: Verify + commit**

Check: no catalog disagreements (`main.rs` has `list_dir` from Task 1; `fileio.ts` wrappers from Task 4 — already landed).

```bash
git add README.md CHANGELOG.md AGENTS.md
git commit -m "docs: catalog workspace folder mode"
```

---

## Close-out (orchestrator/documenter, after Task 6 review)

- Documenter writes the feature report, flips the superseded boundary note in `docs/artifacts/features/typst-packages/2026-09-26-typst-packages-design.md` line 27 (relative imports no longer an error) to **superseded by workspace folder mode**, and ship-bumps **0.6.0 → 0.7.0**: `src-tauri/tauri.conf.json` → `version`, `package.json` → `version`, `src-tauri/Cargo.toml` → `[package].version`, `CHANGELOG.md` `[Unreleased]` → `[0.7.0] - 2026-09-30` with the entries above. Commit: `chore(release): v0.7.0` per repo release policy.
