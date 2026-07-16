# Klad Multi-Plan Manifest

Cross-platform Notepad replacement. 4 plans: 1 foundation + 3 parallel sub-projects.

**Branch naming deviation from the template:** git cannot hold `feat/klad` and `feat/klad/sp-1-...` at the same time (ref file/directory conflict), so sub-project branches use dashes: `feat/klad-sp1-editor` etc.

**No GitHub remote yet:** integration happens with local merges instead of PRs. If you add a remote first, PRs back to `feat/klad` work exactly as the template describes.

## Plans

| ID | Name | Branch | Plan file | Spec file | Depends on | Status |
|----|------|--------|-----------|-----------|------------|--------|
| F | Foundation | `feat/klad` | docs/artifacts/plans/klad/2026-07-16-klad-foundation-plan.md | docs/artifacts/specs/klad/2026-07-16-klad-foundation-design.md | — | ready |
| SP-1 | Editor essentials | `feat/klad-sp1-editor` | docs/artifacts/plans/klad/2026-07-16-klad-sp1-editor-plan.md | docs/artifacts/specs/klad/2026-07-16-klad-sp1-editor-design.md | F done | blocked on F |
| SP-2 | Markdown preview | `feat/klad-sp2-preview` | docs/artifacts/plans/klad/2026-07-16-klad-sp2-preview-plan.md | docs/artifacts/specs/klad/2026-07-16-klad-sp2-preview-design.md | F done | blocked on F |
| SP-3 | Packaging & OS integration | `feat/klad-sp3-packaging` | docs/artifacts/plans/klad/2026-07-16-klad-sp3-packaging-plan.md | docs/artifacts/specs/klad/2026-07-16-klad-sp3-packaging-design.md | F done | blocked on F |

## Execution order

1. **F** — one agent, works directly on `feat/klad` (created from `main`).
2. **After F is complete on `feat/klad`:** SP-1, SP-2, SP-3 in parallel, one (cheaper) agent each, each branch created from `feat/klad`.
   - Parallel agents on one machine MUST use separate worktrees (a shared checkout can't sit on three branches):
     ```sh
     git worktree add ../klad-sp1 -b feat/klad-sp1-editor feat/klad
     git worktree add ../klad-sp2 -b feat/klad-sp2-preview feat/klad
     git worktree add ../klad-sp3 -b feat/klad-sp3-packaging feat/klad
     ```
     Each worktree needs its own `npm install`. Rust `target/` is per-worktree too — first build in each is slow.
3. **Integration** (one agent or by hand, on `feat/klad`): merge SP-1, then SP-2, then SP-3. Expected conflicts SP-1×SP-2: `src/menu.ts` (both add View items — wrap/zoom first, then separator + Markdown Preview; union of `MenuActions` and `MenuHandles`), `src/main.ts` (both extend the actions object and add listeners — keep both), `src/styles.css` (additive — keep both). SP-3 touches none of those.
4. After merges: run the integration checklist below, then merge `feat/klad` → `main`.

## Per-agent dispatch prompts

### F — Foundation
```
Work in C:\Users\ruben\projects\Tools\klad. Create branch feat/klad from main and work directly on it.
Read docs/artifacts/plans/klad/2026-07-16-klad-foundation-plan.md and execute it task-by-task using
superpowers:subagent-driven-development (or superpowers:executing-plans). Commit after every task.
When done: all tasks checked, npm test + cargo test (src-tauri/) + npx tsc --noEmit green, verification
checklist committed. Report a one-line status plus anything you had to deviate on.
```

### SP-1 — Editor essentials (after F)
```
Work in the worktree ../klad-sp1 of C:\Users\ruben\projects\Tools\klad (branch feat/klad-sp1-editor from feat/klad).
Run npm install first. Read docs/artifacts/plans/klad/2026-07-16-klad-sp1-editor-plan.md and execute it
task-by-task using superpowers:subagent-driven-development (or superpowers:executing-plans). Do not change
frozen foundation interfaces. Commit after every task. When done: npm test + cargo test + tsc green,
verification checklist committed. Report a one-line status plus deviations. Stay on your branch — no merging.
```

### SP-2 — Markdown preview (after F)
```
Work in the worktree ../klad-sp2 of C:\Users\ruben\projects\Tools\klad (branch feat/klad-sp2-preview from feat/klad).
Run npm install first. Read docs/artifacts/plans/klad/2026-07-16-klad-sp2-preview-plan.md and execute it
task-by-task using superpowers:subagent-driven-development (or superpowers:executing-plans). No Rust changes.
All rendered HTML goes through DOMPurify. Commit after every task. When done: npm test + tsc green,
verification checklist committed. Report a one-line status plus deviations. Stay on your branch — no merging.
```

### SP-3 — Packaging (after F)
```
Work in the worktree ../klad-sp3 of C:\Users\ruben\projects\Tools\klad (branch feat/klad-sp3-packaging from feat/klad).
Run npm install first. Read docs/artifacts/plans/klad/2026-07-16-klad-sp3-packaging-plan.md and execute it
task-by-task using superpowers:subagent-driven-development (or superpowers:executing-plans). Config/resources/CI
only — no src/ changes. The local NSIS build+install verification is required; Linux lines stay deferred.
Commit after every task. Report a one-line status plus deviations. Stay on your branch — no merging.
```

## Integration checklist (after all SPs merged into `feat/klad`)

- [ ] `npm install` fresh, `npm test` green
- [ ] `cargo test` green (src-tauri/)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run tauri dev`: open a `.md` → split preview + status bar + find/replace all work together
- [ ] Encoding switch + save + reopen still correct with preview open
- [ ] `npm run tauri build` produces the NSIS installer; install; double-click `.md` → Klad with preview
- [ ] Each SP spot-checked against its spec's Testing section
- [ ] Merge `feat/klad` → `main`; clean up worktrees (`git worktree remove ../klad-sp1` etc.)
- [ ] Optional: add GitHub remote, push, tag `v0.1.0` → CI builds Linux artifacts; run Linux checklist lines
