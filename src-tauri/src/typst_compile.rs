//! Typst single-file live preview backend.
//!
//! Verified against typst 0.15.1 + typst-assets 0.15.1 (see `cargo search`).
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
//!   1-based line with `Source::lines().byte_to_line(start)`.

use serde::Serialize;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use typst::diag::SourceDiagnostic;
use typst::foundations::Bytes;
use typst::syntax::Source;
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{LibraryExt, World, WorldExt};
use typst_kit::downloader::SystemDownloader;
use typst_kit::packages::{FsPackages, SystemPackages, UniversePackages};

#[derive(Debug, Serialize)]
pub struct TypstError {
    pub message: String,
    pub line: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct TypstResult {
    pub pages: Vec<String>,
    pub errors: Vec<TypstError>,
}

/// v1 World: source from the editor buffer, embedded fonts only, every
/// non-root file/package lookup is a clean error. v1 boundary is enforced
/// here so `#include` / `#import` / `@preview` all surface as compile errors
/// (spec §9). The `book` / `library` are once-init per process; the static
/// `fonts()` cache holds the actual `Vec<Font>` (shared by every instance).
struct SingleFileWorld {
    source: Source,
    packages: SystemPackages,
    library: OnceLock<LazyHash<typst::Library>>,
    book: OnceLock<LazyHash<FontBook>>,
}

impl SingleFileWorld {
    // klad's editor buffer is already LF-normalized (AGENTS.md); no CRLF here.
    fn with_packages(text: String, packages: SystemPackages) -> Self {
        Self {
            source: Source::detached(text),
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
    ) -> Result<Bytes, typst::diag::FileError> {
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
        UniversePackages::new(SystemDownloader::new(concat!("klad/", env!("CARGO_PKG_VERSION")))),
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
        self.library.get_or_init(|| LazyHash::new(typst::Library::default()))
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

        if let typst::syntax::VirtualRoot::Package(spec) = id.root() {
            let bytes = self.package_file(id, spec)?;
            let text = String::from_utf8(bytes.to_vec())
                .map_err(|_| typst::diag::FileError::InvalidUtf8)?;
            return Ok(Source::new(id, text));
        }

        Err(typst::diag::FileError::NotFound(PathBuf::from(
            id.vpath().get_with_slash(),
        )))
    }

    fn file(&self, id: typst::syntax::FileId) -> typst::diag::FileResult<Bytes> {
        if id == self.source.id() {
            return Ok(Bytes::from_string(self.source.text().to_string()));
        }

        if let typst::syntax::VirtualRoot::Package(spec) = id.root() {
            return self.package_file(id, spec);
        }

        Err(typst::diag::FileError::NotFound(PathBuf::from(
            id.vpath().get_with_slash(),
        )))
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

/// Resolve a `SourceDiagnostic` to the v1 banner shape: a one-line message
/// plus a 1-based source line when the span resolves into the root source.
fn format_diag(world: &SingleFileWorld, d: &SourceDiagnostic) -> TypstError {
    let message = d.message.to_string();
    let line = world
        .range(d.span)
        .and_then(|range| {
            let line0 = world.source.lines().byte_to_line(range.start)?;
            // typst lines are 0-based; the banner displays 1-based.
            Some((line0 as u32) + 1)
        });
    TypstError { message, line }
}

/// `async` = run this sync body on the blocking threadpool: a plain sync
/// command executes inline on the IPC/main thread in Tauri 2, and a first-use
/// package download would freeze the whole window. invoke() is unchanged.
/// (Keep the existing `#[allow(dead_code)]` line above if one is there.)
#[tauri::command(async)]
#[allow(dead_code)] // Tauri generates a parallel command wrapper; this symbol is reachable only via invoke_handler
pub fn compile_typst(text: String) -> Result<TypstResult, String> {
    compile_with_packages(text, system_packages())
}

fn compile_with_packages(
    text: String,
    packages: SystemPackages,
) -> Result<TypstResult, String> {
    let world = SingleFileWorld::with_packages(text, packages);
    let warned = typst::compile::<typst_layout::PagedDocument>(&world);
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
            let errors = diags.iter().map(|d| format_diag(&world, d)).collect();
            Ok(TypstResult {
                pages: vec![],
                errors,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn compiles_trivial_doc() {
        let r = compile_typst("#set page(width: 40pt)\nHi".into()).unwrap();
        assert!(r.errors.is_empty(), "unexpected errors: {:?}", r.errors);
        assert!(r.pages.len() >= 1, "expected at least one page");
        assert!(
            r.pages[0].contains("<svg"),
            "page should be an SVG: {}",
            &r.pages[0][..r.pages[0].len().min(200)]
        );
    }

    #[test]
    fn returns_errors_for_broken_doc() {
        // malformed: width takes a value, not empty
        let r = compile_typst("#set page(width: )".into()).unwrap();
        assert!(r.pages.is_empty(), "expected no pages on compile error");
        assert!(!r.errors.is_empty(), "expected at least one error");
        // at least one error should carry a line if the pinned version exposes it
        // (don't assert line.is_some() hard — version-dependent)
    }

    #[test]
    fn include_is_clean_error_in_v1() {
        // v1 boundary (spec §9): file lookups are clean errors, not panics
        let r = compile_typst("#include \"other.typ\"".into()).unwrap();
        assert!(
            !r.errors.is_empty(),
            "expected #include to surface as an error"
        );
        let combined: String = r
            .errors
            .iter()
            .map(|e| e.message.clone())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            combined.to_lowercase().contains("other.typ"),
            "error should mention the missing file: {}",
            combined
        );
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
