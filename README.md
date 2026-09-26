# Klad

Simple cross-platform Notepad replacement (Windows + Linux) with live Markdown preview. Tauri 2 + CodeMirror 6.

## Features

- Classic Notepad workflow: one window, one file, instant startup
- Find/replace, go-to-line, word wrap, zoom, font choice
- Encodings: UTF-8 (±BOM), UTF-16 LE/BE, legacy (windows-125x); CRLF/LF switching
- Live split Markdown preview (GFM) for `.md` files - KaTeX math (`$...$` / `$$...$$`), Mermaid diagrams, interactive function plots (` ```plot `), two-column layouts (` ```columns `), image scaling (`{N%}`), relative image paths resolved against the open file, and YAML frontmatter rendered as a table
- Live Typst preview (embedded `typst` compile, SVG per page) for `.typ`/`.typst` files - full package support (`@preview` download + local packages), see [Typst preview](#typst-preview)
- Live CSV table preview for `.csv` files (delimiter auto-detected, first row as header)
- Opens anything Notepad opens: `.txt` `.md` `.log` `.ini` `.cfg` `.typ` `.typst` `.csv`

## Install

Grab the installer from the Releases page:
- Windows: `Klad_x.y.z_x64-setup.exe` (per-user, no admin needed)
- Debian/Ubuntu: `klad_x.y.z_amd64.deb` → `sudo apt install ./klad_x.y.z_amd64.deb`
- Other Linux: `klad_x.y.z_amd64.AppImage` → `chmod +x` and run

## Make Klad your default editor

**Windows:** Settings → Apps → Default apps → Klad → add `.txt`, `.md`, `.log`, `.ini`, `.cfg`, `.typ`, `.typst`, `.csv`.
(Or right-click a file → Open with → Choose another app → Klad → Always.)

**Linux:**
```sh
xdg-mime default klad.desktop text/plain
xdg-mime default klad.desktop text/markdown
```

## Typst preview

Opening a `.typ`/`.typst` file shows a live preview next to the editor: the
embedded `typst` compiler runs as you type and renders one SVG per page.
Compile errors appear in a banner while the last good preview stays visible.

### Packages

`#import` works for both registry and local packages:

- **`@preview` packages** (e.g.
  `#import "@preview/fletcher:0.5.8" as fletcher: diagram, node, edge`) are
  downloaded from packages.typst.org on first use and cached on disk. The
  first compile of a new package takes a moment; afterwards it is instant.
  Klad only ever contacts packages.typst.org, and only for `@preview` imports.
- **Local packages** resolve from the standard Typst package directories -
  the same ones the `typst` CLI uses, so installed packages are shared:

| OS | Lookup order |
|---|---|
| Linux | `$XDG_DATA_HOME/typst/packages` (else `~/.local/share/typst/packages`), then `$XDG_CACHE_HOME/typst/packages` (else `~/.cache/typst/packages`) |
| Windows | `%APPDATA%\typst\packages`, then `%LOCALAPPDATA%\typst\packages` |

Any namespace works for local packages (`@local` is the convention). Directory
layout:

    <packages-dir>/<namespace>/<name>/<version>/
    ├── typst.toml   # [package] with name, version, entrypoint
    └── lib.typ

Example: `~/.local/share/typst/packages/local/mylib/0.2.0/` is imported as
`#import "@local/mylib:0.2.0": ...`.

Offline, cached packages keep working; an uncached `@preview` import shows a
clean error in the preview banner.

### Limitations

- No relative imports/includes of files next to the open document - the
  preview compiles the editor buffer only.
- Fonts are the embedded Typst set, not your system fonts.
- No PDF export.

## Development

```sh
npm install
npm run tauri dev    # run
npm test             # frontend tests
cd src-tauri && cargo test   # backend tests
npm run tauri build  # local installer
```

Releases: push a `v*` tag; CI builds Windows + Linux artifacts into a draft GitHub release.

## AI assistance

- **AI involvement:** AI-driven
- **Method:** AI work is organized and professionally executed via a personal
  skill system: brainstorm > spec > plan > subagent execution > review.
  See the [skills repo](https://github.com/RubenVanDerVeen/skills) and
  [how the workflow is organized](https://github.com/RubenVanDerVeen/skills/blob/main/docs/workflows/workflow.md).
