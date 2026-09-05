# Project standards

Human-readable summary of the standards this repository follows. Aimed at contributors who do not use an AI coding agent or the `project-standardization` skill.

For the agent-facing operating notes (bootstrap checklist, triage, references), see the skill itself. **This file is the human contract; the skill is the agent contract.**

---

## Stack

Two layers: formal ISO/IEC/IEEE norms and industry conventions. Klad is a solo tool that ships versioned releases, so it adopts the conventions floor plus ISO 10007 (the repo *is* the configuration management system). The team/formal-document norms (agile docs, user docs, test-doc templates, lifecycle items, IEEE articles) do not apply.

| Standard / convention     | Applied here? | Used for |
|---------------------------|---------------|----------|
| ISO 10007:2017            | yes           | Configuration management — the repo is the CM system; one authoritative source per item; git history is the archive |
| ISO 8601                  | **yes**       | `YYYY-MM-DD` filename prefix for time-based records (specs, plans, checklists) |
| Kebab-case ASCII paths    | **yes**       | All structural directory and filenames |
| English structural paths  | **yes**       | Dir/file names in English; content may be Dutch where needed |
| Conventional Commits 1.0.0 | **yes**       | Commit messages |
| Keep a Changelog 1.1.0    | **yes**       | `CHANGELOG.md` format |
| SemVer 2.0.0              | **yes**       | Release versions for shipped artefacts (canonical source: `src-tauri/tauri.conf.json` → `version`; sync targets: `package.json`, `src-tauri/Cargo.toml`) |

Not applied (solo tool, no sprints / formal test docs / research output): ISO/IEC/IEEE 26515, 26514, 29119-3, 15289; IEEE article format.

---

## Naming rules

### Kebab-case ASCII

Lowercase letters, digits, and hyphens only. No spaces, no underscores, no PascalCase, no non-ASCII.

```
✅ docs/artifacts/features/typst/2026-08-10-typst-single-file-preview-report.md
✅ 2026-07-16-klad-sp1-editor-design.md
❌ Klad SP1/Editor Design.md
❌ klad_sp1_design.md
```

**Language-natural exception:** source filenames follow their language's convention. Rust sources are `snake_case.rs` (`fs_cmds.rs`, `main.rs`); TypeScript sources are the language-natural names (`main.ts`, `fileio.ts`). This is expected and correct; the kebab-case rule governs *structural* paths and authored artefacts, not language-mandated source filenames.

Conventional uppercase filenames kept as-is: `README.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `STANDARDS.md`, `Cargo.toml`, `package.json`.

### English structural paths

Directory and file **names** in English. Document **content** may be Dutch where the deliverable requires it.

### ISO 8601 date prefix

Time-based records start with the date so sort-by-filename yields chronological order:

```
✅ 2026-07-16-klad-foundation-design.md
✅ 2026-07-16-klad-sp1-checklist.md
❌ klad-sp1-design.md          (no date)
❌ 16-07-2026-klad-sp1.md      (wrong order)
```

---

## Commit messages: Conventional Commits 1.0.0

Format: `<type>(<scope>): <description>`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`.

```
✅ feat(preview): add split markdown pane
✅ fix(encoding): correct UTF-16 BE byte order
✅ test(fs-cmds): add windows-1252 round-trip
❌ update stuff
❌ wip
```

Scope is the **module**, not the discipline: `fix(encoding)` not `fix(backend)`.

---

## Changelog: Keep a Changelog 1.1.0

`CHANGELOG.md` at repo root, grouped by semver version. Sections: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. See `CHANGELOG.md` for the current state.

---

## Repository layout

```
klad/
├── README.md                    ← user-facing
├── CHANGELOG.md                 ← version history
├── STANDARDS.md                 ← this file
├── AGENTS.md                    ← agent context (auto-loaded)
├── CLAUDE.md                    ← one-line shim → @AGENTS.md
├── package.json                 ← frontend + build tooling
├── vite.config.ts, tsconfig.json
├── index.html                   ← app shell + native <dialog> markup
├── icon.svg                     ← icon source (→ npm run make-icon)
├── src/                         ← TypeScript frontend (vanilla, CodeMirror 6)
│   ├── main.ts                  ← entry / orchestration
│   ├── __tests__/               ← vitest
│   └── *.ts                     ← document, editor, fileio, menu, preview, render, settings, statusbar, dialogs
├── src-tauri/                   ← Rust backend + Tauri config
│   ├── src/                     ← main.rs (command registration) + fs_cmds.rs (file/encoding logic + tests)
│   ├── capabilities/            ← Tauri 2 ACL (default.json)
│   ├── tauri.conf.json          ← bundle targets, file associations, windows
│   ├── Cargo.toml
│   └── icons/
├── scripts/                     ← make-icon.mjs (sharp)
├── docs/artifacts/              ← process meta-documents (see below)
└── .github/workflows/           ← CI release workflow
```

---

## Source vs deliverable

Klad's shipped artefacts (NSIS installer, `.deb`, `.AppImage`) are produced by CI and attached to GitHub Releases — they are **not** committed to the repo. There is no in-repo generated-document split (no PDF/DOCX deliverables); the source ↔ deliverable distinction here is *source code in repo* vs *built binaries on Releases*.

---

## Specs, plans, reviews

`docs/artifacts/` holds process meta-documents. Two top-level dirs: `reviews/` (flat log) and `features/<feature>/` (one folder per feature, flat contents, filename suffix signals type).

Per-feature artefacts (all under one folder):

- `docs/artifacts/features/<feature>/YYYY-MM-DD-<topic>-design.md`: design spec.
- `docs/artifacts/features/<feature>/YYYY-MM-DD-<topic>-plan.md`: implementation plan.
- `docs/artifacts/features/<feature>/YYYY-MM-DD-<topic>-report.md`: execution report for a completed plan.

Reviews (flat log, not per-feature):

- `docs/artifacts/reviews/YYYY-MM-DD-<topic>-review.md`: audits and reviews.
- `docs/artifacts/reviews/YYYY-MM-DD-<topic>-audit.md`: same shape, suffix variant for audits.

`multi-plan-orchestration` outlines and manifests also live inside the relevant `features/<topic>/` folder; there is no separate `multi-plans/` bucket.

Historical `docs/artifacts/specs/`, `docs/artifacts/plans/`, and `docs/artifacts/multi-plans/` are being migrated into `features/<feature>/`. Do not add new files to the legacy buckets; create the new one in `features/` instead. Each artefact is append-only history; if a design changes mid-implementation, edit in place + add an `## Amendments` section. Filenames use the `YYYY-MM-DD-<kebab-topic>-<type>.md` grammar.

---

## Forbidden patterns

- No `temp/`, no `old/`, no `archive/` directories. Git history is the archive.
- No secrets in tracked files (`.env`, tokens, passwords).
- No PascalCase or spaces in authored filenames.
- No `docs/superpowers/` or `.planning/` — specs/plans/reviews go to `docs/artifacts/`. Move, never delete, if one appears.

---

## References

- Full standards-stack rationale: research paper <https://portfolio.rvdv-lab.nl/research.html?id=project-standaardenpakket-voor-het-idp-project> (local copy at `docs/research/<paper>.pdf` when present).
- Conventional Commits 1.0.0: <https://www.conventionalcommits.org/en/v1.0.0/>
- Keep a Changelog 1.1.0: <https://keepachangelog.com/en/1.1.0/>
- ISO 8601 date format: <https://www.iso.org/iso-8601-date-and-time-format.html>
- `AGENTS.md` convention: <https://agents.md>
