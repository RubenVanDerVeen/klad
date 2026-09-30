# Plan: file tree nested subdirectory interaction fix

- Spec: docs/artifacts/features/tree-subdir-toggle-bug/2026-09-30-tree-subdir-toggle-bug-design.md
- Branch: `fix/tree-subdir-toggle` (cut from `main`)
- Date: 2026-09-30
- Versioning: canonical source `src-tauri/tauri.conf.json`; expected bump **patch → 0.7.1** at close-out (sync `package.json`, `src-tauri/Cargo.toml`)

## Summary

`toggleDir()` in `src/tree.ts` adopts the next sibling row as its child container.
For nested directories that sibling is another entry row (dirs sort first), so
expansion corrupts the sibling: label wiped, child rows nested inside a
`.tree-row`, collapse deletes the row. Fix: mark the container with
`tree-children` and only accept a sibling carrying that marker.

## File Structure

- Modify: `src/tree.ts`, 3-line guard + class on box creation in `toggleDir()`.
- Modify: `src/__tests__/tree.test.ts`, add jsdom DOM regression test (existing
  pure-function tests stay as-is; file gains `// @vitest-environment jsdom` pragma).
- Modify: `CHANGELOG.md`, `Fixed` entry under a `0.7.1` release heading.

## Task 1: regression test + fix for nested dir toggle

**Files:**
- Modify: `src/tree.ts` (`toggleDir`, lines ~60-82)
- Test: `src/__tests__/tree.test.ts`

**Depends:** none

**Interfaces:**
- Consumes: existing exports `initTree(hooks)`, `renderTreeRoot(root)`; `TreeHooks { onOpen(path: string): void; listDir(path: string): Promise<TreeEntry[]> }`.
- Produces: unchanged public API. DOM convention: child container of a dir row is the `div.tree-children` immediately after it.

TDD: the test is written first and must FAIL on current `main`, then the fix makes it pass.

- [ ] **Step 1: Write the failing regression test**

At the top of `src/__tests__/tree.test.ts` add the jsdom pragma (before imports) and extend imports:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { initTree, renderTreeRoot, sortEntries, visibleEntries, type TreeEntry } from "../tree";
```

(keep the existing `sortEntries`/`visibleEntries` import if already present; merge, don't duplicate). Append:

```ts
describe("renderTreeRoot DOM", () => {
  const dir = (name: string, path: string): TreeEntry => ({ name, path, isDir: true });
  const file = (name: string, path: string): TreeEntry => ({ name, path, isDir: false });

  function setup() {
    const opened: string[] = [];
    const listings: Record<string, TreeEntry[]> = {
      "/proj": [dir("alpha", "/proj/alpha"), file("keep.typ", "/proj/keep.typ")],
      "/proj/alpha": [file("b.typ", "/proj/alpha/b.typ"), file("c.typ", "/proj/alpha/c.typ")],
    };
    initTree({
      onOpen: (p) => opened.push(p),
      listDir: (p) => Promise.resolve(listings[p] ?? []),
    });
    return { opened };
  }

  it("expanding a nested dir does not swallow the following sibling row", async () => {
    setup();
    document.body.innerHTML = `<aside id="sidebar"><div id="sidebar-title"></div><div id="tree"></div></aside>`;
    await renderTreeRoot("/proj");

    const alpha = document.querySelector<HTMLElement>('[data-path="/proj/alpha"]')!;
    alpha.click(); // expand, alpha is followed by keep.typ (the v0.7.0 blind spot)
    await vi.waitFor(() => {
      expect(document.querySelector('[data-path="/proj/alpha/b.typ"]')).toBeTruthy();
    });

    const keep = document.querySelector<HTMLElement>('[data-path="/proj/keep.typ"]')!;
    expect(keep.textContent).toBe("keep.typ");            // label not wiped
    expect(keep.querySelector(".tree-row")).toBeNull();   // no child rows nested inside
    expect(keep.classList.contains("tree-children")).toBe(false);

    // children live in a dedicated sibling container, not inside keep.typ
    const box = alpha.nextElementSibling as HTMLElement;
    expect(box.classList.contains("tree-children")).toBe(true);
    expect(box.querySelectorAll('[data-path="/proj/alpha/b.typ"]').length).toBe(1);
    expect(box.querySelectorAll('[data-path="/proj/alpha/c.typ"]').length).toBe(1);
  });

  it("clicking a child file opens exactly that file", async () => {
    const { opened } = setup();
    document.body.innerHTML = `<aside id="sidebar"><div id="sidebar-title"></div><div id="tree"></div></aside>`;
    await renderTreeRoot("/proj");

    document.querySelector<HTMLElement>('[data-path="/proj/alpha"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-path="/proj/alpha/b.typ"]')).toBeTruthy();
    });
    document.querySelector<HTMLElement>('[data-path="/proj/alpha/b.typ"]')!.click();

    expect(opened).toEqual(["/proj/alpha/b.typ"]);
  });

  it("collapsing a nested dir removes only its container, sibling stays", async () => {
    setup();
    document.body.innerHTML = `<aside id="sidebar"><div id="sidebar-title"></div><div id="tree"></div></aside>`;
    await renderTreeRoot("/proj");

    const alpha = document.querySelector<HTMLElement>('[data-path="/proj/alpha"]')!;
    alpha.click(); // expand
    await vi.waitFor(() => {
      expect(document.querySelector('[data-path="/proj/alpha/b.typ"]')).toBeTruthy();
    });
    alpha.click(); // collapse

    expect(document.querySelector('[data-path="/proj/alpha/b.typ"]')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-path="/proj/keep.typ"]')!.textContent).toBe("keep.typ");
  });
});
```

Note: `renderTreeRoot` awaits the root toggle internally, so after `await renderTreeRoot(...)` the root children exist synchronously; only nested expansion needs `vi.waitFor` (async `listDir`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/tree.test.ts`
Expected: the first and third new tests FAIL (`keep.typ` label overwritten with child rows / removed), the second may fail too (wrong `onOpen` path or duplicate opens). Existing `sortEntries`/`visibleEntries` tests still PASS.

- [ ] **Step 3: Implement the fix in `src/tree.ts`**

In `toggleDir`, replace:

```ts
  let box = row.nextElementSibling as HTMLElement | null;
```

with:

```ts
  let box = row.nextElementSibling as HTMLElement | null;
  if (!box?.classList.contains("tree-children")) box = null;
```

and replace the creation block:

```ts
  if (!box) {
    box = document.createElement("div");
    row.after(box);
  }
```

with:

```ts
  if (!box) {
    box = document.createElement("div");
    box.className = "tree-children";
    row.after(box);
  }
```

No other changes. Collapse path (`box?.remove()`) and both call sites stay untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/__tests__/tree.test.ts`
Expected: all tests PASS (3 new + existing pure-function tests).
Run: `npm test`
Expected: full suite PASS, no regressions elsewhere.

- [ ] **Step 5: Commit**

```bash
git add src/tree.ts src/__tests__/tree.test.ts
git commit -m "fix(tree): stop nested dir toggle from swallowing the next sibling row

toggleDir located its child container via nextElementSibling, which for a
nested directory is the following entry row (dirs sort first). The row was
adopted as the box: its label was wiped, child rows nested inside it, and
collapse deleted it. Mark the container with tree-children and only accept
a sibling carrying that marker."
```

## Task 2: changelog entry

**Files:**
- Modify: `CHANGELOG.md`

**Depends:** Task 1

**Interfaces:**
- Consumes: none (doc-only; cites the fixed behavior from Task 1).
- Produces: none.

- [ ] **Step 1: Add the Fixed entry**

In `CHANGELOG.md`, add a new `## [0.7.1]` section directly under `## [Unreleased]` (mirror the existing heading style and link pattern used by prior releases; if `[Unreleased]` has content, leave it and add `## [0.7.1]` below it):

```markdown
## [0.7.1]

### Fixed

- Workspace file tree: expanding a subdirectory no longer corrupts the rows
  after it (hover selecting all children, clicks opening the wrong file, and
  rows disappearing on collapse).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): record file tree subdir toggle fix in 0.7.1"
```

(The `0.7.1` version bump itself, `tauri.conf.json`, `package.json`, `src-tauri/Cargo.toml`, and the changelog links/footer, is performed by the close-out documenter per the versioning policy.)

## Verification (whole plan)

- [ ] `npm test`, full suite green, including the 3 new regression tests.
- [ ] `cd src-tauri && cargo test`, untouched, but run for parity if CI expects it.
- [ ] Manual smoke (optional, executor judgment): `npm run tauri dev`, open a folder whose root has a subdirectory followed by a file, expand/collapse/click, rows stay individual.

## Self-Review

- Spec coverage: root cause (Task 1 Step 3), regression test (Step 1), changelog (Task 2), version bump (close-out documenter, stated in header). Covered.
- Placeholders: none; all steps carry exact code/commands.
- Type consistency: `TreeEntry`/`TreeHooks` signatures match `src/tree.ts` exports; `tree-children` class name consistent across test and fix.
- Parallel readiness: Task 2 Depends: Task 1 (shares the changelog narrative but different file; dependency kept because the Fixed text cites shipped fix). Task 1 is the only `Depends: none` task.
