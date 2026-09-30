//! Typst live preview backend.
//!
//! Verified against typst 0.15.1 + typst-assets 0.15.1.
//!
//! API surface (pinned 0.15.1):
//! - `typst::compile::<PagedDocument>(&dyn World) -> Warned<SourceResult<PagedDocument>>`
//!   where `Warned { output, warnings: EcoVec<SourceDiagnostic> }` and
//!   `SourceResult<T> = Result<T, EcoVec<SourceDiagnostic>>`.
//! - `typst::World` trait requires: `library`, `book`, `main`, `source`, `file`,
//!   `font`, `today` (no `package`/`resolve` in this version).
//! - `typst::Source::detached(text) -> Source` (root = `/main.typ`, interned
//!   via `RootedPath`/`VirtualRoot::Project`).
//! - `typst_assets::fonts() -> impl Iterator<Item = &'static [u8]>` (feature
//!   `fonts`); paired with `Font::new(Bytes::new(bytes), 0)` and
//!   `FontBook::push(info)`.
//! - `typst_svg::svg(page: &Page, opts: &SvgOptions) -> String` for per-page
//!   SVG; `SvgOptions: Default` (both fields default to `false`).
//! - Diagnostics: `SourceDiagnostic { span: DiagSpan, message: EcoString, .. }`.
//!   Resolve the byte range via `WorldExt::range(diag.span)` and convert to a
//!   1-based line with the span's file's `Source::lines().byte_to_line`.
//!
//! Workspace / folder mode: when the frontend passes a `root` and a `path` that
//! lies under it, the entry's `FileId` is project-rooted and lookups in
//! `source()` / `file()` resolve to files on disk under `root`, with
//! `overrides` (forward-slash relpaths of dirty buffers) shadowing the disk.
//! `VirtualRoot::Project` is a unit variant in 0.15.1, so the project root
//! path lives in `SingleFileWorld.project_root` rather than on the FileId.

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use typst::diag::{FileError, SourceDiagnostic};
use typst::foundations::Bytes;
use typst::syntax::{RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{LibraryExt, World, WorldExt};
use typst_kit::downloader::SystemDownloader;
use typst_kit::packages::{FsPackages, SystemPackages, UniversePackages};

#[derive(Debug, Serialize)]
pub struct TypstError {
    pub message: String,
    pub line: Option<u32>,
    pub file: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TypstResult {
    pub pages: Vec<String>,
    pub errors: Vec<TypstError>,
}

/// v1 World with an optional workspace overlay: source from the editor
/// buffer, embedded fonts, package lookup matching the typst CLI, and (when
/// `project_root` is `Some`) project-rooted file lookups against that root
/// with an `overrides` hashmap shadowing dirty buffers.
struct SingleFileWorld {
    source: Source,
    project_root: Option<PathBuf>,
    overrides: HashMap<String, String>,
    packages: SystemPackages,
    library: OnceLock<LazyHash<typst::Library>>,
    book: OnceLock<LazyHash<FontBook>>,
}

impl SingleFileWorld {
    // klad's editor buffer is already LF-normalized (AGENTS.md); no CRLF here.
    fn detached(text: String, packages: SystemPackages) -> Self {
        Self {
            source: Source::detached(text),
            project_root: None,
            overrides: HashMap::new(),
            packages,
            library: OnceLock::new(),
            book: OnceLock::new(),
        }
    }

    fn with_root(
        source: Source,
        project_root: PathBuf,
        overrides: HashMap<String, String>,
        packages: SystemPackages,
    ) -> Self {
        Self {
            source,
            project_root: Some(project_root),
            overrides,
            packages,
            library: OnceLock::new(),
            book: OnceLock::new(),
        }
    }

    /// Read one file out of a package, obtaining (downloading if needed)
    /// the package directory first.
    // ponytail: re-reads package files from disk every compile; fine at
    // human typing rates — add an in-memory cache only if preview feels slow.
    fn package_file(
        &self,
        id: typst::syntax::FileId,
        spec: &typst::syntax::package::PackageSpec,
    ) -> Result<Bytes, FileError> {
        let root = self.packages.obtain(spec)?;
        root.load(id.vpath())
    }
}

/// Package lookup matching the typst CLI: OS data dir, OS cache dir, then
/// download from packages.typst.org for the `preview` namespace.
fn system_packages() -> SystemPackages {
    SystemPackages::from_parts(
        FsPackages::system_data(),
        FsPackages::system_cache(),
        UniversePackages::new(SystemDownloader::new(concat!(
            "klad/",
            env!("CARGO_PKG_VERSION")
        ))),
    )
}

// ponytail: OnceLock rather than LazyLock — `world` instances are short-lived
// (one per Tauri command call) but the embedded font book + bytes are the
// heavy part and benefit from a single parse per process, not per compile.
fn fonts() -> &'static (LazyHash<FontBook>, Vec<Font>) {
    static FONTS: OnceLock<(LazyHash<FontBook>, Vec<Font>)> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut book = FontBook::new();
        let mut fonts = Vec::new();
        for bytes in typst_assets::fonts() {
            // typst-assets' `fonts()` returns font file bytes; each
            // .otf/.ttf is a single-face collection here, so index 0.
            let data = Bytes::new(bytes.to_vec());
            if let Some(font) = Font::new(data, 0) {
                book.push(font.info().clone());
                fonts.push(font);
            }
        }
        (LazyHash::new(book), fonts)
    })
}

impl World for SingleFileWorld {
    fn library(&self) -> &LazyHash<typst::Library> {
        self.library
            .get_or_init(|| LazyHash::new(typst::Library::default()))
    }

    fn book(&self) -> &LazyHash<FontBook> {
        self.book
            .get_or_init(|| LazyHash::new(fonts().0.clone().into_inner()))
    }

    fn main(&self) -> typst::syntax::FileId {
        self.source.id()
    }

    fn source(&self, id: typst::syntax::FileId) -> typst::diag::FileResult<Source> {
        if id == self.source.id() {
            return Ok(self.source.clone());
        }

        if let VirtualRoot::Package(spec) = id.root() {
            let bytes = self.package_file(id, spec)?;
            let text = String::from_utf8(bytes.to_vec()).map_err(|_| FileError::InvalidUtf8)?;
            return Ok(Source::new(id, text));
        }

        // Project-rooted lookup.
        let Some(root) = &self.project_root else {
            return Err(FileError::NotFound(PathBuf::from(
                id.vpath().get_with_slash(),
            )));
        };
        // Use the no-leading-slash form so override keys (forward-slash
        // relpaths) match directly.
        let rel = id.vpath().get_without_slash().to_string();
        if let Some(text) = self.overrides.get(&rel) {
            return Ok(Source::new(id, text.clone()));
        }
        let path = id.vpath().realize(root).map_err(FileError::Realize)?;
        let text =
            std::fs::read_to_string(&path).map_err(|e| FileError::from_io(e, &path))?;
        Ok(Source::new(id, text))
    }

    fn file(&self, id: typst::syntax::FileId) -> typst::diag::FileResult<Bytes> {
        if id == self.source.id() {
            return Ok(Bytes::from_string(self.source.text().to_string()));
        }

        if let VirtualRoot::Package(spec) = id.root() {
            return self.package_file(id, spec);
        }

        // Project-rooted lookup (raw bytes, e.g. images).
        let Some(root) = &self.project_root else {
            return Err(FileError::NotFound(PathBuf::from(
                id.vpath().get_with_slash(),
            )));
        };
        let path = id.vpath().realize(root).map_err(FileError::Realize)?;
        let bytes = std::fs::read(&path).map_err(|e| FileError::from_io(e, &path))?;
        Ok(Bytes::new(bytes))
    }

    fn font(&self, index: usize) -> Option<Font> {
        fonts().1.get(index).cloned()
    }

    fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<typst::foundations::Datetime> {
        // ponytail: UTC date. A "true local" date needs Win32
        // GetTimeZoneInformation / libc localtime_r, neither in std. The spec
        // §3.1 says "verify against the pinned version's `World::today`
        // signature"; the signature only needs `Option<Datetime>`, and
        // typst's `datetime.today()` without an offset just uses the value
        // we hand back. Users on CET see UTC dates — accept the discrepancy
        // for v1; add a local-zone shim when datetime matters to a layout.
        let (y, m, d) = utc_ymd(SystemTime::now());
        typst::foundations::Datetime::from_ymd(y, m, d)
    }
}

/// Forward-slash relpath of `path` under `root`, or `None` when outside (or
/// equal to root). Accepts both `/` and `\` separators in inputs.
fn rel_path_under(root: &str, path: &str) -> Option<String> {
    let norm = |p: &str| p.replace('\\', "/");
    let r = norm(root).trim_end_matches('/').to_string();
    let p = norm(path).trim_end_matches('/').to_string();
    if !p.starts_with(&format!("{r}/")) {
        return None;
    }
    Some(p[r.len() + 1..].to_string())
}

/// Resolve a `SourceDiagnostic` to the banner shape: message, 1-based line in
/// the span's source (when resolvable), and the span's file vpath.
fn format_diag(world: &SingleFileWorld, d: &SourceDiagnostic) -> TypstError {
    let message = d.message.to_string();
    let span_id = d.span.id();
    let line = span_id.and_then(|id| {
        let range = world.range(d.span)?;
        let src = world.source(id).ok()?;
        let line0 = src.lines().byte_to_line(range.start)?;
        Some((line0 as u32) + 1)
    });
    let file = span_id.map(|id| id.vpath().get_without_slash().to_string());
    TypstError { message, line, file }
}

/// `async` = run this sync body on the blocking threadpool: a plain sync
/// command executes inline on the IPC/main thread in Tauri 2, and a first-use
/// package download would freeze the whole window. invoke() is unchanged.
#[tauri::command(async)]
#[allow(dead_code)] // Tauri generates a parallel command wrapper; this symbol is reachable only via invoke_handler
pub fn compile_typst(
    text: String,
    path: Option<String>,
    root: Option<String>,
    overrides: HashMap<String, String>,
) -> Result<TypstResult, String> {
    let packages = system_packages();
    // Choose entry source: project-rooted when both `path` and `root` are
    // supplied and `path` lies under `root`; detached fallback otherwise.
    if let (Some(p), Some(r)) = (path.as_deref(), root.as_deref()) {
        if let Some(rel) = rel_path_under(r, p) {
            let vpath = VirtualPath::new(rel.as_str()).map_err(|e| e.to_string())?;
            let id = RootedPath::new(VirtualRoot::Project, vpath).intern();
            let world = SingleFileWorld::with_root(
                Source::new(id, text),
                PathBuf::from(r),
                overrides,
                packages,
            );
            return compile_with_world(&world);
        }
    }
    let world = SingleFileWorld::detached(text, packages);
    compile_with_world(&world)
}

#[cfg(test)]
fn compile_with_packages(
    text: String,
    packages: SystemPackages,
) -> Result<TypstResult, String> {
    let world = SingleFileWorld::detached(text, packages);
    compile_with_world(&world)
}

fn compile_with_world(world: &SingleFileWorld) -> Result<TypstResult, String> {
    let warned = typst::compile::<typst_layout::PagedDocument>(world);
    // Warnings are out-of-band; v1 banner shows errors only. Surfacing
    // warnings can land in a later polish slice.
    let _ = warned.warnings;
    match warned.output {
        Ok(document) => {
            let opts = typst_svg::SvgOptions::default();
            let pages = document
                .pages()
                .iter()
                .map(|page| typst_svg::svg(page, &opts))
                .collect();
            Ok(TypstResult { pages, errors: vec![] })
        }
        Err(diags) => {
            let errors = diags.iter().map(|d| format_diag(world, d)).collect();
            Ok(TypstResult {
                pages: vec![],
                errors,
            })
        }
    }
}

/// Convert a `SystemTime` to a (year, month, day) tuple in UTC. Howard
/// Hinnant's civil-from-days algorithm: ~15 lines, no `chrono`/`time` dep.
fn utc_ymd(now: SystemTime) -> (i32, u8, u8) {
    let secs = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    civil_from_unix_days(secs / 86_400)
}

// Hinnant's civil_from_days: takes days since 1970-01-01, returns (y,m,d).
// See http://howardhinnant.github.io/date_algorithms.html#civil_from_days.
fn civil_from_unix_days(z: i64) -> (i32, u8, u8) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u8, d as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::any::Any;
    use std::io::{ErrorKind, Read};
    use std::path::Path;
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

    /// Write a file at `<root>/<rel>`, creating parent dirs as needed.
    fn write_file(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, content).unwrap();
    }

    /// Test-only wrapper: invoke the command exactly as the IPC layer does,
    /// exercising the (path, root, overrides) surface.
    fn compile_with(
        text: &str,
        path: Option<&str>,
        root: Option<&str>,
        overrides: HashMap<String, String>,
    ) -> TypstResult {
        compile_typst(
            text.to_string(),
            path.map(String::from),
            root.map(String::from),
            overrides,
        )
        .unwrap()
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

    #[test]
    fn compiles_trivial_doc() {
        let r =
            compile_with("#set page(width: 40pt)\nHi", None, None, HashMap::new());
        assert!(r.errors.is_empty(), "unexpected errors: {:?}", r.errors);
        assert!(!r.pages.is_empty(), "expected at least one page");
        assert!(
            r.pages[0].contains("<svg"),
            "page should be an SVG: {}",
            &r.pages[0][..r.pages[0].len().min(200)]
        );
    }

    #[test]
    fn returns_errors_for_broken_doc() {
        // malformed: width takes a value, not empty
        let r =
            compile_typst("#set page(width: )".into(), None, None, HashMap::new()).unwrap();
        assert!(r.pages.is_empty(), "expected no pages on compile error");
        assert!(!r.errors.is_empty(), "expected at least one error");
    }

    #[test]
    fn imports_error_without_root() {
        // preserves old v1 coverage (was: include_is_clean_error_in_v1)
        let result =
            compile_with("#import \"other.typ\": x\n#x", None, None, HashMap::new());
        assert!(!result.errors.is_empty());
    }

    #[test]
    fn project_imports_resolve_across_files() {
        let root = fixture_dir("ws_project_imports");
        write_file(&root, "lib.typ", "#let greeting = [hello]");
        write_file(&root, "ch1/main.typ", "#import \"../lib.typ\": greeting\n#greeting");
        let result = compile_with(
            "#import \"../lib.typ\": greeting\n#greeting",
            Some(root.join("ch1/main.typ").to_string_lossy().as_ref()),
            Some(root.to_string_lossy().as_ref()),
            HashMap::new(),
        );
        std::fs::remove_dir_all(&root).ok();
        assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
        assert_eq!(result.pages.len(), 1);
    }

    #[test]
    fn dirty_override_wins_over_disk() {
        let root = fixture_dir("ws_dirty_override");
        // disk copy is broken; override supplies valid text -> compile succeeds only if override used
        write_file(&root, "lib.typ", "#let greeting = ");
        write_file(&root, "main.typ", "#import \"lib.typ\": greeting\n#greeting");
        let mut overrides = HashMap::new();
        overrides.insert("lib.typ".to_string(), "#let greeting = [hi]".to_string());
        let result = compile_with(
            "#import \"lib.typ\": greeting\n#greeting",
            Some(root.join("main.typ").to_string_lossy().as_ref()),
            Some(root.to_string_lossy().as_ref()),
            overrides,
        );
        std::fs::remove_dir_all(&root).ok();
        assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
    }

    #[test]
    fn missing_import_stays_clean_error() {
        let root = fixture_dir("ws_missing_import");
        let result = compile_with(
            "#import \"nope.typ\": x\n#x",
            Some(root.join("main.typ").to_string_lossy().as_ref()),
            Some(root.to_string_lossy().as_ref()),
            HashMap::new(),
        );
        std::fs::remove_dir_all(&root).ok();
        assert!(!result.errors.is_empty());
        assert!(
            result.errors[0].message.contains("nope.typ"),
            "msg: {}",
            result.errors[0].message
        );
    }

    #[test]
    fn error_in_imported_file_carries_file() {
        let root = fixture_dir("ws_error_file");
        write_file(&root, "lib.typ", "#assert(false)");
        write_file(&root, "main.typ", "#import \"lib.typ\"\n");
        let result = compile_with(
            "#import \"lib.typ\"\n",
            Some(root.join("main.typ").to_string_lossy().as_ref()),
            Some(root.to_string_lossy().as_ref()),
            HashMap::new(),
        );
        std::fs::remove_dir_all(&root).ok();
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
            Some(elsewhere.join("main.typ").to_string_lossy().as_ref()),
            Some(root.to_string_lossy().as_ref()),
            HashMap::new(),
        );
        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&elsewhere).ok();
        assert!(!result.errors.is_empty(), "entry outside root must behave as detached");
    }

    #[test]
    fn project_file_resolves_binary_asset() {
        let root = fixture_dir("ws_binary_asset");
        write_file(
            &root,
            "tiny.svg",
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><rect width=\"10\" height=\"10\" fill=\"red\"/></svg>",
        );
        let result = compile_with(
            "#image(\"tiny.svg\")",
            Some(root.join("main.typ").to_string_lossy().as_ref()),
            Some(root.to_string_lossy().as_ref()),
            HashMap::new(),
        );
        std::fs::remove_dir_all(&root).ok();
        assert!(result.errors.is_empty(), "errors: {:?}", result.errors);
        assert_eq!(result.pages.len(), 1);
    }
}
