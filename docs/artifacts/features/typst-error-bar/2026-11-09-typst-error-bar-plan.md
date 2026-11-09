# Plan: Typst error bar - slim top bar in preview pane

- Spec: docs/artifacts/features/typst-error-bar/2026-11-09-typst-error-bar-design.md
- Branch: `feat/typst-error-bar` (cut from default branch)
- Expected version bump: **minor** (feat; user-visible behavior change). Canonical source: `src-tauri/tauri.conf.json` -> `version`; documenter ship-bumps at close-out (0.7.2 -> 0.8.0 expected) and adds a CHANGELOG `[Unreleased]` entry.
- No Rust changes. No `index.html` changes. No dependency changes. No `main.rs`/`fileio.ts` catalog changes (public TS surface unchanged: `TypstError`/`TypstResult` untouched, only internal preview.ts functions re-shaped).

## Root cause (from spec)

`errorBannerEl()` (src/preview.ts:94-111) prepends the banner to `pane().parentElement` = `#content`, a `display: flex` **row** (src/styles.css:40-44) → banner renders as a full-height column left of the sidebar. Fix: the bar becomes the first child **inside `#preview`** (which is the scroll container, `overflow: auto`, styles.css:66), pinned with `position: sticky; top: 0`.

---

### Task 1: Move error banner into preview pane as slim sticky bar

**Files:**
- Modify: `src/preview.ts:90-136` (banner block + `applyTypstResult`)
- Modify: `src/styles.css` (new `#preview-error` block; place it directly after the `.mermaid-error` dark override ending at line 212, before the `/* Tab bar */` comment)
- Create: `src/__tests__/typst-error-bar.test.ts`

**Depends:** none

**Interfaces:**
- Consumes: `TypstResult { pages: string[]; errors: TypstError[] }` and `TypstError { message: string; line?: number | null; file?: string | null }` from `src/fileio.ts:27-36` (unchanged).
- Produces: no exports change. Internal: `showErrorBanner(errors: TypstError[])` (was `(e: TypstError)`); bar element `#preview-error` lives as a child of `#preview` with `.preview-error-msg`, `.preview-error-count` spans and `.preview-error-close` button. Later tasks/docs rely on: user-visible behavior "slim bar atop preview pane".

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/typst-error-bar.test.ts` (pattern follows `src/__tests__/preview-images.test.ts`; note the invoke mock must be declared before importing `../preview`):

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { renderPreviewNow, setPreviewKind, setPreviewVisible } from "../preview";

const invokeMock = vi.mocked(invoke);

describe("typst error bar", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="content"><div id="preview"></div></div>';
    invokeMock.mockReset();
    setPreviewKind("typ");
    setPreviewVisible(true);
  });

  it("renders inside #preview with first error, count, and full-text title", async () => {
    invokeMock.mockResolvedValue({
      pages: [],
      errors: [
        { message: "unknown variable: x", line: 2, file: "main.typ" },
        { message: "second failure", line: 5, file: null },
      ],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    const bar = document.querySelector<HTMLElement>("#preview > #preview-error")!;
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector<HTMLElement>(".preview-error-msg")!.textContent).toBe(
      "line 2: unknown variable: x",
    );
    expect(bar.querySelector<HTMLElement>(".preview-error-count")!.textContent).toBe("+1");
    expect(bar.title).toBe("line 2: unknown variable: x (+1 more)");
    expect(bar.querySelector<HTMLElement>(".preview-error-close")).not.toBeNull();
  });

  it("omits the count badge for a single error", async () => {
    invokeMock.mockResolvedValue({
      pages: [],
      errors: [{ message: "boom", line: null, file: null }],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    const bar = document.querySelector<HTMLElement>("#preview > #preview-error")!;
    expect(bar.querySelector<HTMLElement>(".preview-error-msg")!.textContent).toBe("boom");
    expect(bar.querySelector<HTMLElement>(".preview-error-count")!.textContent).toBe("");
  });

  it("dismiss button hides the bar", async () => {
    invokeMock.mockResolvedValue({
      pages: [],
      errors: [{ message: "boom", line: null, file: null }],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    (document.querySelector<HTMLElement>("#preview > #preview-error .preview-error-close")!).
      click();
    const bar = document.querySelector<HTMLElement>("#preview > #preview-error")!;
    expect(bar.hidden).toBe(true);
  });

  it("hides the bar when a later compile succeeds", async () => {
    invokeMock.mockResolvedValueOnce({
      pages: [],
      errors: [{ message: "boom", line: null, file: null }],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    invokeMock.mockResolvedValueOnce({ pages: ["<svg/>"], errors: [] });
    renderPreviewNow("#typst fixed");
    await vi.waitFor(() => {
      // success wipes pane children, so the bar is gone from the DOM entirely
      expect(document.querySelector("#preview > #preview-error")).toBe(null);
    });
    expect(document.querySelector("#preview .typst-page")).not.toBeNull();
  });

  it("recreates the bar after pane content was replaced (innerHTML orphan)", async () => {
    invokeMock.mockResolvedValueOnce({
      pages: [],
      errors: [{ message: "boom", line: 1, file: null }],
    });
    renderPreviewNow("#typst");
    await vi.waitFor(() => {
      expect(document.querySelector("#preview > #preview-error")).not.toBeNull();
    });
    invokeMock.mockResolvedValueOnce({ pages: ["<svg/>"], errors: [] });
    renderPreviewNow("#typst ok"); // success wipes pane children incl. the bar
    await vi.waitFor(() => {
      expect(document.querySelector("#preview .typst-page")).not.toBeNull();
    });
    invokeMock.mockResolvedValueOnce({
      pages: [],
      errors: [{ message: "boom again", line: 1, file: null }],
    });
    renderPreviewNow("#typst broken");
    await vi.waitFor(() => {
      const bar = document.querySelector<HTMLElement>("#preview > #preview-error");
      expect(bar?.hidden).toBe(false);
      expect(bar?.querySelector<HTMLElement>(".preview-error-msg")?.textContent).toBe(
        "line 1: boom again",
      );
    });
  });
});
```

Note: `file: "main.typ"` produces **no** `file:` prefix in the expected text because `lastCompileRoot` is only set via the typst project provider, absent in this fixture (`preview.ts:116` gate), the test pins the gate behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/typst-error-bar.test.ts`
Expected: FAIL, bar appears as child of `#content` (old `pane().parentElement?.prepend`), so `#preview > #preview-error` selectors come up null / `hidden` expectations fail.

- [ ] **Step 3: Implement the bar in `src/preview.ts`**

Replace lines 90-136 (from the `// --- error banner ...` comment through the end of `applyTypstResult`) with:

```ts
// --- error bar (built from TS; no index.html change) ----------------------

let errorBanner: HTMLElement | null = null;

function errorBannerEl(): HTMLElement {
  // isConnected check: pane().innerHTML wipes the bar on a successful render;
  // recreate it lazily instead of returning an orphaned node.
  if (errorBanner?.isConnected) return errorBanner;
  const el = document.createElement("div");
  el.id = "preview-error";
  el.hidden = true;

  const msg = document.createElement("span");
  msg.className = "preview-error-msg";
  el.appendChild(msg);

  const count = document.createElement("span");
  count.className = "preview-error-count";
  el.appendChild(count);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "preview-error-close";
  close.setAttribute("aria-label", "Dismiss error");
  close.textContent = "✕";
  close.addEventListener("click", () => {
    el.hidden = true;
  });
  el.appendChild(close);

  pane().prepend(el);
  errorBanner = el;
  return el;
}

function showErrorBanner(errors: TypstError[]): void {
  // ponytail: Source::detached still interns FileId(Project, /main.typ), so
  // err.file is non-null without a workspace, gate the file prefix on root.
  const first = errors[0]!;
  const filePart = first.file != null && lastCompileRoot != null ? `${first.file}:` : "";
  const linePart = first.line != null ? `line ${first.line}: ` : "";
  const el = errorBannerEl();
  const text = `${filePart}${linePart}${first.message}`;
  const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
  el.querySelector<HTMLElement>(".preview-error-msg")!.textContent = text;
  el.title = `${text}${more}`;
  el.querySelector<HTMLElement>(".preview-error-count")!.textContent =
    errors.length > 1 ? `+${errors.length - 1}` : "";
  el.hidden = false;
}

function hideErrorBanner(): void {
  if (errorBanner) errorBanner.hidden = true;
}

// --- render paths ---------------------------------------------------------

function applyTypstResult(result: TypstResult): void {
  if (result.errors.length > 0) {
    showErrorBanner(result.errors);
    return; // keep last-good pane contents
  }
  hideErrorBanner();
  pane().innerHTML = result.pages.map((svg) => `<div class="typst-page">${svg}</div>`).join("");
}
```

Everything else in `src/preview.ts` stays as-is: `renderTypstNow`, `renderPreviewNow` (md/csv branches still call `hideErrorBanner()`), `setPreviewVisible` still calls `hideErrorBanner()`. The `TypstError` import at `src/preview.ts:2` remains (still used by the new signature).

- [ ] **Step 4: Add the CSS in `src/styles.css`**

Insert directly after the `[data-theme="dark"] #preview .mermaid-error` rule (ends line 212), before `/* Tab bar */`:

```css
/* Typst error bar: slim sticky strip atop the preview pane */
#preview-error {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 -16px; /* full-bleed across #preview's 0 16px padding */
  padding: 4px 8px;
  background: #fde8e8;
  border-bottom: 1px solid #f0c0c0;
  color: #b00;
  font-family: var(--editor-font-family, monospace);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
}
#preview-error .preview-error-msg {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
#preview-error .preview-error-count {
  flex: none;
  font-weight: 600;
}
#preview-error .preview-error-close {
  flex: none;
  margin-left: auto;
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
  padding: 0 4px;
  font-size: 12px;
  line-height: 1;
  border-radius: 3px;
}
#preview-error .preview-error-close:hover { background: rgba(0, 0, 0, 0.08); }
[data-theme="dark"] #preview-error {
  background: #2e1a1a;
  border-bottom-color: #5a2a2a;
  color: #f87171;
}
[data-theme="dark"] #preview-error .preview-error-close:hover {
  background: rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 5: Run the full frontend suite**

Run: `npm test`
Expected: PASS, all suites green (`typst-error-bar.test.ts` 5/5, existing suites untouched and green).

- [ ] **Step 6: Typecheck + build**

Run: `npm run build`
Expected: `tsc` clean, vite build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/preview.ts src/styles.css src/__tests__/typst-error-bar.test.ts
git commit -m "feat(preview): show typst errors on slim bar atop preview pane"
```

---

## Verification checklist (maps to spec)

- Bar renders inside `#preview` (first child), placement regression pinned by test 1.
- Single line + ellipsis + `title` tooltip, CSS block + `el.title` assignment.
- `+N` badge for multiple errors, absent for single, tests 1, 2.
- Dismiss button hides bar, test 3.
- Auto-hide on success, and md/csv branches + `setPreviewVisible(false)` unchanged, tests 4, 5 + untouched call sites.
- Theme-aware colors (light + `[data-theme="dark"]`), CSS block.
- No changes to: Rust payload, `index.html`, splitter DOM/CSS (`#preview-handle:has(+ #preview[hidden])`), `uilayout.ts`, dependencies.
