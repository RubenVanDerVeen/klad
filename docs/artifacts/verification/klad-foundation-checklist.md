# Foundation verification — 2026-07-16

- [x] `npm test` green — PASS — Vitest reported 1 test file and 4 tests passed; exit 0.
- [x] `cargo test` green (run in src-tauri/) — PASS — Rust reported 5 tests passed, 0 failed; exit 0.
- [x] `npx tsc --noEmit` clean — PASS — no diagnostics; exit 0.
- [x] `npm run build` clean — PASS — TypeScript completed and Vite built 34 modules; exit 0.
- [x] `cargo clippy --all-targets -- -D warnings` clean (run in src-tauri/) — PASS — completed with no warnings; exit 0.
- [ ] App boots to empty Untitled editor, focused — MANUAL — requires human running `npm run tauri dev` in a desktop session. Reason: orchestrator session is Windows PowerShell non-GUI.
- [ ] Typing marks title dirty (*) — MANUAL — requires human running `npm run tauri dev` in a desktop session. Reason: orchestrator session is Windows PowerShell non-GUI.
- [ ] New/Open/Save/Save As/Exit all reachable via menu AND shortcut — MANUAL — requires human running `npm run tauri dev` in a desktop session. Reason: orchestrator session is Windows PowerShell non-GUI.
- [ ] Save→reopen round-trip preserves content exactly (create a file with CRLF in another editor, open, save, confirm CRLF preserved via `git diff --no-index` or a hex viewer) — MANUAL — requires human running `npm run tauri dev` in a desktop session. Reason: orchestrator session is Windows PowerShell non-GUI.
- [ ] UTF-8 BOM file keeps its BOM after save — MANUAL — requires human running `npm run tauri dev` in a desktop session. Reason: orchestrator session is Windows PowerShell non-GUI.
- [ ] Unsaved-changes prompt on: New, Open, Exit, window X — all three buttons behave — MANUAL — requires human running `npm run tauri dev` in a desktop session. Reason: orchestrator session is Windows PowerShell non-GUI.
- [ ] Open failure (delete a file, then open it via a stale path if reproducible — otherwise open a locked file) shows the error dialog, app stays alive — MANUAL — requires human running `npm run tauri dev` in a desktop session. Reason: orchestrator session is Windows PowerShell non-GUI.
