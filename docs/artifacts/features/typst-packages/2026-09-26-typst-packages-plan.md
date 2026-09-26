# Typst Package Support — Implementation Plan

**Spec:** `docs/artifacts/features/typst-packages/2026-09-26-typst-packages-design.md` (read first: behavior contract §5.2, catalog table §6, error handling §7).
**Branch:** `feat/typst-packages` cut from latest `main`. Commit at task boundaries per AGENTS.md carve-out; do not push.
**Versioning:** project is versioned (canonical `src-tauri/tauri.conf.json` → `0.5.0`) but release cutting is deliberate → **no version bump; CHANGELOG `[Unreleased]` entry only.**

## Context for the implementer

Klad's Typst preview compiles one in-memory source per keystroke: Tauri command `compile_typst(text)` (`src-tauri/src/typst_compile.rs`) builds a `SingleFileWorld` (impl of typst's `World` trait) and returns SVG pages + errors. Today every non-main `source()`/`file()` lookup returns `FileError::NotFound`, so `#import "@preview/fletcher:0.5.8"` fails.

typst 0.15.1 has **no package method on `World`**. Package imports arrive as `FileId`s whose `root()` is `VirtualRoot::Package(PackageSpec)`; the world must map spec → directory and serve files. typst-kit 0.15.1 (exact tarball-verified API):

- `typst_kit::packages::SystemPackages::from_parts(data: Option<FsPackages>, cache: Option<FsPackages>, universe: UniversePackages)` → `.obtain(&PackageSpec) -> PackageResult<FsRoot>`; tries data dir → cache dir → download+extract for `@preview` (tempdir-then-rename, no partial entries).
- `FsPackages::new(path)` / `FsPackages::system_data()` / `system_cache()`; layout `<dir>/<namespace>/<name>/<version>/`.
- `UniversePackages::new(impl Downloader)` → packages.typst.org; non-`preview` namespaces return `NotFound` **without network**.
- `typst_kit::downloader::{Downloader (trait, stream/download), SystemDownloader (ureq2 + native-tls)}`.
- `FsRoot::load(&VirtualPath) -> FileResult<Bytes>` handles path-escape denial.
- `From<PackageError> for FileError` exists (typst-cli relies on `?`), so `self.packages.obtain(spec)?` compiles in a `FileResult` fn.

Design decision (spec §5.1): mirror typst-cli's hand-rolled pattern; **do not** use `FileStore`/`SystemFiles` — its caching would serve stale editor text across keystrokes. Main-id early-return in `source()`/`file()` stays; only a `VirtualRoot::Package` branch is added.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src-tauri/Cargo.toml` + `Cargo.lock` | deps | Modify — add `typst-kit` |
| `src-tauri/src/typst_compile.rs` | world + command + inline tests | Modify — package branch + tests |
| `README.md` | user-facing docs | Modify — limitations wording |
| `CHANGELOG.md` | release notes | Modify — `[Unreleased]` Added entry |

Explicitly untouched (catalog self-check, spec §6): `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `package.json`, `index.html`, everything under `src/` (frontend).

---

### Task 1: Backend — package resolution in `SingleFileWorld`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock` (via cargo)
- Modify: `src-tauri/src/typst_compile.rs` (world at ~line 50, `source()`/`file()` at ~102-120, command at ~153-179, tests at ~181-227)

**Depends:** none

**Interfaces:**
- Consumes: existing `compile_typst(text: String) -> Result<TypstResult, String>` command (signature unchanged).
- Produces: private `fn system_packages() -> SystemPackages`, private `fn compile_with_packages(text: String, packages: SystemPackages) -> Result<TypstResult, String>`, private `SingleFileWorld::with_packages(text: String, packages: SystemPackages)`. Nothing leaves this file; the Tauri command contract is byte-identical for the frontend.

- [ ] **Step 1: Add the dependency and verify what it pulls**

```bash
cargo add typst-kit@0.15.1 --features system-packages,universe-packages,system-downloader
cargo fetch
```

(run in `src-tauri/`). Expected new locked deps: `typst-kit`, `ureq`, `native-tls`, `openssl`/`openssl-sys`, `env-proxy`, `tar`, `flate2`, `fastrand`. Record them in the task report (`git diff Cargo.lock | grep -E '^\+name'`). Linux links system OpenSSL — same dependency graph the typst CLI ships; note it in the report (escape hatch if build breaks: add `vendor-openssl` feature).

- [ ] **Step 2: Confirm the three API details this plan leans on**

```bash
grep -n "pub mod" ~/.cargo/registry/src/*/typst-kit-0.15.1/src/lib.rs
grep -n "pub enum FileError" -A 20 ~/.cargo/registry/src/*/typst-library-0.15.1/src/diag.rs
grep -rn "impl From<PackageError> for FileError" -A 8 ~/.cargo/registry/src/*/typst-library-0.15.1/src/
grep -n "pub fn new\|pub fn obtain\|pub fn from_parts" ~/.cargo/registry/src/*/typst-kit-0.15.1/src/packages.rs
```

Confirm: module is `downloader` (not `download`); `FileError::InvalidUtf8` is a unit variant; `From<PackageError> for FileError` exists; constructor names match Step 4. If any differ, adjust Step 4's code to the real signatures and say so in the report.

- [ ] **Step 3: Write the failing tests**

Inside the existing `#[cfg(test)] mod tests` in `typst_compile.rs`, add:

```rust
    use std::any::Any;
    use std::io::{ErrorKind, Read};
    use std::path::{Path, PathBuf};
    use typst_kit::downloader::Downloader;
    use typst_kit::packages::{FsPackages, SystemPackages, UniversePackages};

    /// Downloader that never touches the network — tests must not download.
    struct NoNetwork;

    impl Downloader for NoNetwork {
        fn stream(
            &self,
            _key: &dyn Any,
            _url: &str,
        ) -> std::io::Result<(Option<usize>, Box<dyn Read>)> {
            Err(std::io::Error::new(ErrorKind::NotFound, "no network in tests"))
        }
    }

    /// Packages with a temp data dir, no cache dir, and a dead universe URL.
    /// FsPackages' root is the "packages" dir itself (mirrors
    /// `FsPackages::system_data()` passing `data_dir.join("typst/packages")`).
    fn test_packages(data_dir: &Path) -> SystemPackages {
        SystemPackages::from_parts(
            Some(FsPackages::new(data_dir.join("typst/packages"))),
            None,
            UniversePackages::with_url(NoNetwork, "http://127.0.0.1:9"),
        )
    }

    /// Create `<tmp>/typst/packages/local/tiny/0.1.0/` with a minimal package.
    fn fixture_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("klad-typst-pkg-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let pkg = dir.join("typst/packages/local/tiny/0.1.0");
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::write(
            pkg.join("typst.toml"),
            "[package]\nname = \"tiny\"\nversion = \"0.1.0\"\nentrypoint = \"lib.typ\"\n",
        )
        .unwrap();
        std::fs::write(pkg.join("lib.typ"), "#let greeting = \"hello package\"\n").unwrap();
        dir
    }

    #[test]
    fn imports_local_package() {
        let dir = fixture_dir("local");
        let r = compile_with_packages(
            "#import \"@local/tiny:0.1.0\": greeting\n#greeting".to_string(),
            test_packages(&dir),
        )
        .unwrap();
        assert!(r.errors.is_empty(), "errors: {:?}", r.errors);
        assert_eq!(r.pages.len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_package_is_clean_error() {
        let dir = fixture_dir("missing");
        let r = compile_with_packages(
            "#import \"@local/missing:9.9.9\": x".to_string(),
            test_packages(&dir),
        )
        .unwrap();
        assert!(!r.errors.is_empty());
        assert!(r.pages.is_empty());
        assert!(
            r.errors[0].message.to_lowercase().contains("package"),
            "message: {}",
            r.errors[0].message
        );
        std::fs::remove_dir_all(&dir).ok();
    }
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cargo test` (in `src-tauri/`)
Expected: FAIL to compile — `compile_with_packages` not defined. (This is the red step.)

- [ ] **Step 5: Implement**

In `typst_compile.rs`:

1. Add imports near the existing typst ones:

```rust
use typst_kit::downloader::SystemDownloader;
use typst_kit::packages::{FsPackages, SystemPackages, UniversePackages};
```

2. Extend the struct and constructors (keep the existing field-init style; `library`/`book` init unchanged):

```rust
struct SingleFileWorld {
    source: Source,
    packages: SystemPackages,
    library: OnceLock<LazyHash<typst::Library>>,
    book: OnceLock<LazyHash<FontBook>>,
}
```

```rust
    fn new(text: String) -> Self {
        Self::with_packages(text, system_packages())
    }

    fn with_packages(text: String, packages: SystemPackages) -> Self {
        Self {
            source: Source::detached(text),
            packages,
            library: OnceLock::new(),
            book: OnceLock::new(),
        }
    }
```

```rust
/// Package lookup matching the typst CLI: OS data dir, OS cache dir, then
/// download from packages.typst.org for the `preview` namespace.
fn system_packages() -> SystemPackages {
    SystemPackages::from_parts(
        FsPackages::system_data(),
        FsPackages::system_cache(),
        UniversePackages::new(SystemDownloader::new(concat!("klad/", env!("CARGO_PKG_VERSION")))),
    )
}
```

3. In `impl World for SingleFileWorld`, keep the existing main-id early-return in `source()` exactly as is, and insert a package branch before the existing `NotFound` return in both methods:

```rust
    fn source(&self, id: FileId) -> Result<Source, FileError> {
        // ... existing main-id early-return (unchanged) ...

        if let typst::syntax::VirtualRoot::Package(spec) = id.root() {
            let bytes = self.package_file(id, spec)?;
            let text = String::from_utf8(bytes.to_vec())
                .map_err(|_| FileError::InvalidUtf8)?;
            return Ok(Source::new(id, text));
        }

        // ... existing NotFound return (unchanged) ...
    }

    fn file(&self, id: FileId) -> Result<Bytes, FileError> {
        if let typst::syntax::VirtualRoot::Package(spec) = id.root() {
            return self.package_file(id, spec);
        }

        // ... existing NotFound return (unchanged) ...
    }
```

4. Helper on the world (in the inherent `impl SingleFileWorld` block):

```rust
    /// Read one file out of a package, obtaining (downloading if needed)
    /// the package directory first.
    // ponytail: re-reads package files from disk every compile; fine at
    // human typing rates — add an in-memory cache only if preview feels slow.
    fn package_file(
        &self,
        id: FileId,
        spec: &typst::syntax::package::PackageSpec,
    ) -> Result<Bytes, FileError> {
        let root = self.packages.obtain(spec)?;
        root.load(id.vpath())
    }
```

5. Split the command so tests can inject packages (no behavior change):

```rust
// `async` = run this sync body on the blocking threadpool: a plain sync
// command executes inline on the IPC/main thread in Tauri 2, and a first-use
// package download would freeze the whole window. invoke() is unchanged.
// (Keep the existing `#[allow(dead_code)]` line above if one is there.)
#[tauri::command(async)]
pub fn compile_typst(text: String) -> Result<TypstResult, String> {
    compile_with_packages(text, system_packages())
}

fn compile_with_packages(
    text: String,
    packages: SystemPackages,
) -> Result<TypstResult, String> {
    // ... existing compile_typst body, with
    //     let world = SingleFileWorld::with_packages(text, packages);
    // as the world construction ...
}
```

If `Source`, `Bytes`, `FileId`, `FileError` path/import spellings differ from the above, follow the file's existing imports — only the package branch is new.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test` (in `src-tauri/`)
Expected: PASS — the 2 new tests plus all existing (`compiles_trivial_doc`, `returns_errors_for_broken_doc`, `include_is_clean_error_in_v1` must stay green: relative includes still error).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/typst_compile.rs
git commit -m "feat(typst): resolve @preview and local packages in live preview

Wire typst-kit's SystemPackages into SingleFileWorld: package-rooted
FileIds resolve through the OS package data dir, the shared typst cache
dir, and (preview namespace only) a one-time download from
packages.typst.org. Local and preview packages now import cleanly;
missing packages surface as compile errors in the existing preview
banner. No frontend or IPC changes."
```

---

### Task 2: Docs, changelog, catalog self-check, manual smoke

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Depends:** Task 1

**Interfaces:**
- Consumes: Task 1's shipped behavior (packages resolve in preview).
- Produces: none (docs only).

- [ ] **Step 1: README**

Read `README.md`, find the Typst preview section/limitations (also check whether `.agents/todolist.md`'s "Document Typst preview limitations" item describes wording used there). Replace/extend the package-related limitation with:

> Typst preview supports packages: `@preview` packages are downloaded from packages.typst.org on first use and cached on disk (shared with the typst CLI), and local packages resolve from the standard typst package directory (`~/.local/share/typst/packages` on Linux, `%APPDATA%\typst\packages` on Windows). Relative includes of files next to the open document are still unsupported.

- [ ] **Step 2: CHANGELOG**

In `CHANGELOG.md`, under `[Unreleased]` → `### Added` (create the section if absent, Keep a Changelog 1.1.0 style):

```markdown
- Typst live preview now resolves `@preview` packages (downloaded from
  packages.typst.org on first use and cached, shared with the typst CLI)
  and local packages from the standard typst package directories.
```

- [ ] **Step 3: Catalog self-check (AGENTS.md "Adding features")**

```bash
git diff main --stat
```

Expected: only `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/typst_compile.rs`, `README.md`, `CHANGELOG.md`, and the new `docs/artifacts/features/typst-packages/` files. **No** changes to `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `package.json`, `index.html`, or `src/**`. If any appear, stop and reconcile against spec §6.

- [ ] **Step 4: Manual smoke (network test — not in CI)**

```bash
npm run tauri dev
```

1. Open a `.typ` file containing:

```typst
#import "@preview/fletcher:0.5.8" as fletcher: node, edge
#set page(width: auto, height: auto, margin: 8pt)
#fletcher.diagram(
  node-stroke: .1em,
  spacing: 4em,
  edge((-1,0), (0,0), "->", label: [hi]),
  node((0,0), [rust], radius: 2em),
)
```

2. First render: brief delay (download), then the diagram appears.
3. Type a space: re-render is fast (disk cache, no re-download).
4. Break it: `#import "@preview/no-such-package-xyz:0.0.1"` → clean error banner, no crash, last-good preview kept.
5. Run `npm test` — green (frontend untouched).

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(typst): document package support in live preview"
```

---

## Self-review

- **Spec coverage:** goals 1-3 = Task 1 (resolution order is `SystemPackages::obtain`'s own: data → cache → universe); goal 4 = package errors flow through `FileError` → existing `format_diag` banner; goal 5 + catalog table §6 = Task 1 interfaces unchanged + Task 2 Step 3 self-check; §6 README/CHANGELOG = Task 2 Steps 1-2; §8 tests = Task 1 Steps 3-6 + Task 2 Step 4; §9 = versioning note above. Non-goals untouched.
- **Placeholders:** none; code shown for every code step; the three greps in Task 1 Step 2 pin the only externally-leveraged signatures.
- **Type consistency:** `compile_with_packages`, `with_packages`, `system_packages`, `package_file` names used identically in Steps 3, 5; `SystemPackages`/`FsPackages`/`UniversePackages`/`Downloader` match typst-kit 0.15.1 verbatim.
