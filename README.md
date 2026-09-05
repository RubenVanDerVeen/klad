# Klad

Simple cross-platform Notepad replacement (Windows + Linux) with live Markdown preview. Tauri 2 + CodeMirror 6.

## Features

- Classic Notepad workflow: one window, one file, instant startup
- Find/replace, go-to-line, word wrap, zoom, font choice
- Encodings: UTF-8 (±BOM), UTF-16 LE/BE, legacy (windows-125x); CRLF/LF switching
- Live split Markdown preview (GFM) for `.md` files
- Live Typst preview (embedded `typst` compile, SVG per page) for `.typ`/`.typst` files — single-file only (no `#include`/`#import`, no `@preview` packages)
- Opens anything Notepad opens: `.txt` `.md` `.log` `.ini` `.cfg` `.typ` `.typst`

## Install

Grab the installer from the Releases page:
- Windows: `Klad_x.y.z_x64-setup.exe` (per-user, no admin needed)
- Debian/Ubuntu: `klad_x.y.z_amd64.deb` → `sudo apt install ./klad_x.y.z_amd64.deb`
- Other Linux: `klad_x.y.z_amd64.AppImage` → `chmod +x` and run

## Make Klad your default editor

**Windows:** Settings → Apps → Default apps → Klad → add `.txt`, `.md`, `.log`, `.ini`, `.cfg`, `.typ`, `.typst`.
(Or right-click a file → Open with → Choose another app → Klad → Always.)

**Linux:**
```sh
xdg-mime default klad.desktop text/plain
xdg-mime default klad.desktop text/markdown
```

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
