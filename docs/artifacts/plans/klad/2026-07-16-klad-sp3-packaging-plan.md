# Klad SP-3: Packaging & OS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows NSIS installer with file associations (.txt .md .markdown .log .ini .cfg), Linux .deb + AppImage with MIME registration, app icon, CI release workflow, install docs.

**Architecture:** Everything through `tauri-bundler` config in `tauri.conf.json` — no runtime code. Icon generated from an SVG via a one-off sharp script + `tauri icon`. GitHub Actions (`tauri-action`) builds both platforms on version tags; local verification is Windows-only (dev box), Linux artifacts verified via CI once the repo has a remote.

**Tech Stack:** tauri-bundler (already in `@tauri-apps/cli`), `sharp` (devDependency, icon generation only), `tauri-apps/tauri-action` (CI).

**Spec:** `docs/artifacts/specs/klad/2026-07-16-klad-sp3-packaging-design.md`

## Global Constraints

- Branch: `feat/klad-sp3-packaging`, created from the merged `feat/klad`. (Deviation from the manifest-template naming `feat/klad/sp-3-...`: git forbids `feat/klad/...` while branch `feat/klad` exists.)
- No changes to `src/` or `src-tauri/src/` — config, resources, docs, CI only.
- Identifier stays `dev.ruben.klad`; product name stays `Klad`.
- Associated extensions, exact list: `txt`, `md`, `markdown`, `log`, `ini`, `cfg`.
- NSIS `installMode: "currentUser"` (no admin prompt).
- Commit after every task.
- `npm run tauri build` needs the NSIS toolchain; the Tauri CLI downloads it automatically on first Windows bundle — allow that.

---

### Task 1: App icon

**Files:**
- Create: `icon.svg`, `scripts/make-icon.mjs`, `src-tauri/icons/*` (generated)
- Modify: `package.json` (devDependency + script)

**Interfaces:**
- Consumes: nothing.
- Produces: `src-tauri/icons/` populated (`icon.ico`, `icon.icns`, `32x32.png`, `128x128.png`, `128x128@2x.png`, …) for Task 2's `bundle.icon` list.

- [ ] **Step 1: Create `icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" rx="180" fill="#1e66d0"/>
  <text x="512" y="700" font-family="Segoe UI, Arial, sans-serif" font-size="560"
        font-weight="700" fill="#ffffff" text-anchor="middle">K</text>
</svg>
```

- [ ] **Step 2: Create `scripts/make-icon.mjs`**

```js
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const png = await sharp("icon.svg").resize(1024, 1024).png().toBuffer();
await writeFile("app-icon.png", png);
const meta = await sharp("app-icon.png").metadata();
if (meta.width !== 1024 || meta.height !== 1024) {
  throw new Error(`icon is ${meta.width}x${meta.height}, expected 1024x1024`);
}
console.log("app-icon.png ok (1024x1024)");
```

- [ ] **Step 3: Generate**

Run: `npm install -D sharp`
Run: `node scripts/make-icon.mjs`
Expected: `app-icon.png ok (1024x1024)`.

Open `app-icon.png` and confirm the white "K" on blue actually rendered (SVG text needs a rasterizer with font support; if the "K" is missing, replace the `<text>` element with an outlined path — e.g. regenerate the SVG with the letter converted to a `<path>` — and rerun).

Run: `npm run tauri icon app-icon.png`
Expected: files written to `src-tauri/icons/` including `icon.ico` and `icon.icns`.

Add `app-icon.png` to `.gitignore` (generated intermediate); commit `icon.svg`, the script, and `src-tauri/icons/`.

- [ ] **Step 4: Commit**

```bash
git add .gitignore icon.svg scripts/make-icon.mjs src-tauri/icons package.json package-lock.json
git commit -m "feat: app icon and generation script"
```

---

### Task 2: Bundle configuration with file associations

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: icons (Task 1), foundation's CLI-arg open (`get_startup_file`).
- Produces: buildable NSIS/deb/AppImage bundles registering Klad for the six extensions.

- [ ] **Step 1: Replace the `bundle` section of `src-tauri/tauri.conf.json`**

```json
"bundle": {
  "active": true,
  "targets": ["nsis", "deb", "appimage"],
  "category": "Utility",
  "shortDescription": "Simple cross-platform notepad",
  "longDescription": "Klad is a simple Notepad replacement for Windows and Linux with live Markdown preview.",
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ],
  "fileAssociations": [
    { "ext": ["txt"], "name": "Text Document", "description": "Text Document", "mimeType": "text/plain", "role": "Editor" },
    { "ext": ["md", "markdown"], "name": "Markdown Document", "description": "Markdown Document", "mimeType": "text/markdown", "role": "Editor" },
    { "ext": ["log"], "name": "Log File", "description": "Log File", "mimeType": "text/plain", "role": "Editor" },
    { "ext": ["ini"], "name": "Configuration File", "description": "Configuration File", "mimeType": "text/plain", "role": "Editor" },
    { "ext": ["cfg"], "name": "Configuration File", "description": "Configuration File", "mimeType": "text/plain", "role": "Editor" }
  ],
  "windows": {
    "nsis": { "installMode": "currentUser" }
  },
  "linux": {
    "deb": { "section": "editors" }
  }
}
```

- [ ] **Step 2: Validate config**

Run: `npm run tauri build -- --no-bundle` (config is parsed; app compiles release)
Expected: completes without config schema errors. (Full bundle comes in Task 5.)

If the schema rejects a key, check `https://schema.tauri.app/config/2` for the installed CLI version and fix the key — do not delete the association entries.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: bundle config with file associations for txt/md/log/ini/cfg"
```

---

### Task 3: Linux desktop entry / MIME fallback check

**Files:**
- Possibly create: `src-tauri/klad.desktop`
- Possibly modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: Task 2 config.
- Produces: guarantee that the generated `.desktop` file carries `MimeType=text/plain;text/markdown;`.

- [ ] **Step 1: Determine whether tauri-bundler emits MimeType from fileAssociations**

On this Windows box the deb bundler doesn't run, so check the source of truth: in the installed CLI's bundler (search `node_modules/@tauri-apps/cli` is a binary — instead check the Tauri docs/source on the web for the installed version: does the generated `.desktop` include `MimeType` derived from `bundle.fileAssociations[].mimeType`?).

If YES: record that in the commit message and skip Step 2.

If NO or UNCLEAR: apply the fallback in Step 2 (harmless either way).

- [ ] **Step 2 (fallback): Custom desktop template**

Create `src-tauri/klad.desktop`:
```
[Desktop Entry]
Categories={{categories}}
Comment={{comment}}
Exec={{exec}} {{exec_arg}}
Icon={{icon}}
Name={{name}}
Terminal=false
Type=Application
MimeType=text/plain;text/markdown;
```

Add to the `linux` section of the bundle config:
```json
"linux": {
  "deb": {
    "section": "editors",
    "desktopTemplate": "./klad.desktop"
  },
  "appimage": {}
}
```
(If the schema of the installed CLI exposes `desktopTemplate` under a different path — e.g. directly under `linux` — follow the schema; the requirement is only that the template is used for the generated `.desktop`.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/klad.desktop
git commit -m "feat: linux desktop entry with text/plain and text/markdown MIME"
```

---

### Task 4: CI release workflow + README

**Files:**
- Create: `.github/workflows/release.yml`, `README.md`

**Interfaces:**
- Consumes: bundle config.
- Produces: tag-triggered draft releases with Windows + Linux artifacts; user-facing install/default-app docs.

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: release

on:
  push:
    tags: ["v*"]

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        platform: [windows-latest, ubuntu-22.04]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: dtolnay/rust-toolchain@stable

      - name: Install Linux dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev

      - run: npm ci

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Klad ${{ github.ref_name }}"
          releaseDraft: true
```

Note: `npm ci` requires `package-lock.json` in the repo — the foundation committed it; verify with `git ls-files package-lock.json` (must print the filename).

- [ ] **Step 2: Create `README.md`**

````markdown
# Klad

Simple cross-platform Notepad replacement (Windows + Linux) with live Markdown preview. Tauri 2 + CodeMirror 6.

## Features

- Classic Notepad workflow: one window, one file, instant startup
- Find/replace, go-to-line, word wrap, zoom, font choice
- Encodings: UTF-8 (±BOM), UTF-16 LE/BE, legacy (windows-125x); CRLF/LF switching
- Live split Markdown preview (GFM) for `.md` files
- Opens anything Notepad opens: `.txt` `.md` `.log` `.ini` `.cfg`

## Install

Grab the installer from the Releases page:
- Windows: `Klad_x.y.z_x64-setup.exe` (per-user, no admin needed)
- Debian/Ubuntu: `klad_x.y.z_amd64.deb` → `sudo apt install ./klad_x.y.z_amd64.deb`
- Other Linux: `klad_x.y.z_amd64.AppImage` → `chmod +x` and run

## Make Klad your default editor

**Windows:** Settings → Apps → Default apps → Klad → add `.txt`, `.md`, `.log`, `.ini`, `.cfg`.
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
````

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml README.md
git commit -m "feat: CI release workflow and README"
```

---

### Task 5: Local Windows build + install verification

**Files:**
- Create: `docs/artifacts/verification/klad-sp3-checklist.md`

- [ ] **Step 1: Build**

Run: `npm run tauri build`
Expected: NSIS installer at `src-tauri/target/release/bundle/nsis/Klad_0.1.0_x64-setup.exe`. (deb/appimage targets are skipped on Windows — expected.)

- [ ] **Step 2: Install and verify, recording results**

Create `docs/artifacts/verification/klad-sp3-checklist.md`:
```markdown
# SP-3 verification — YYYY-MM-DD (Windows local)

- [ ] Installer runs without admin prompt (currentUser mode)
- [ ] Start menu shows Klad with the blue K icon
- [ ] Right-click a .txt → Open with → Klad listed
- [ ] Set Klad as default for .txt and .md (Settings → Default apps)
- [ ] Double-click a .txt → opens IN KLAD with content loaded (foundation startup-file path)
- [ ] Double-click a .md → opens in Klad WITH split preview
- [ ] Window title shows the file name; taskbar shows the K icon
- [ ] Uninstall (Settings → Installed apps) → double-click .txt falls back to picker/Notepad

# Linux (deferred to CI/Linux box)
- [ ] .deb installs; klad.desktop present with MimeType=text/plain;text/markdown;
- [ ] xdg-mime default commands from README work; xdg-open a .txt opens Klad
```

Mark the Windows lines PASS/FAIL by actually doing them. Leave the Linux lines unchecked with the note — they run on CI after the repo gets a GitHub remote, or on any Linux machine.

- [ ] **Step 3: Commit**

```bash
git add docs/artifacts/verification/klad-sp3-checklist.md
git commit -m "test: sp-3 windows install verification results"
```

---

## Self-review notes (already applied)

- Spec coverage: icon (T1), associations + NSIS (T2), Linux MIME (T3), CI + README (T4), local verification (T5).
- Honest limits recorded: Linux packages cannot be smoke-tested on the Windows dev box; the checklist carries explicit deferred lines instead of pretending.
- No runtime code touched; the startup-file behavior this SP depends on was built and unit-verified in the foundation, and gets its end-to-end verification here (double-click test).
