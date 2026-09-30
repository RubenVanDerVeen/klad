# File tree: nested subdirectory interaction bug (v0.7.0)

- Type: design (bug fix spec)
- Status: approved
- Date: 2026-09-30
- Affects: `src/tree.ts`, `src/__tests__/tree.test.ts`

## Problem

v0.7.0 workspace sidebar tree: after expanding a subdirectory, its files cannot be
interacted with individually. Reported on both Linux (.deb) and Windows (.exe):

1. Hovering one child file highlights all of them.
2. Clicking opens exactly one (wrong-ish) file.
3. Afterwards the files are not shown in the tree anymore.

## Root cause

`toggleDir(row, path, depth)` in `src/tree.ts` locates a directory's child
container with `row.nextElementSibling` and only creates a fresh `<div>` when
that is null:

```ts
let box = row.nextElementSibling as HTMLElement | null;
...
if (!box) { box = document.createElement("div"); row.after(box); }
box.replaceChildren(...entries.map((e) => rowFor(e, depth + 1)));
```

This holds only for the workspace root row, whose box is its sole sibling inside
`#tree`. A nested directory row lives inside its parent's container among sibling
entry rows, and `sortEntries` sorts dirs first, so a subdirectory is followed by
another entry row in nearly every real listing. `toggleDir` adopts that sibling
entry row as its "box":

- `box.replaceChildren(...)` wipes the sibling's label and nests the child rows
  inside a `.tree-row`. CSS `:hover` applies to ancestors, so hovering any child
  highlights the swallowed outer row, symptom 1.
- The swallowed row keeps its original per-row click listener, so a click inside
  the block opens that one file, symptom 2.
- Collapse (or the next expand) calls `box.remove()` on the swallowed row and
  deletes it (and its nested rows) from the tree, symptom 3.

Pure DOM logic; engine-independent, matching the .deb and .exe reports. The v0.7.0
manual smoke test passed because the tested directory was the last entry in its
parent (null sibling → correct fresh box).

## Fix

Mark the child container with a class (`tree-children`) when created, and accept
`row.nextElementSibling` as the box only when it carries that marker; otherwise
create a fresh box. The lookup stops being a heuristic: a box is only ever
inserted directly after its row (`row.after(box)`), and nothing else in the
codebase inserts elements into the tree, so marker + position is unambiguous.

Minimal diff in `toggleDir`:

```ts
let box = row.nextElementSibling as HTMLElement | null;
if (!box?.classList.contains("tree-children")) box = null;
```

plus `box.className = "tree-children"` at creation (or `classList.add`).

Collapse path (`box?.remove()`) is then always removing a real box.

## Alternatives considered

1. **Marker-class guard on next sibling (chosen):** ~3 lines, keeps the module
   stateless, box is only reachable via its row.
2. **`WeakMap<row, box>` registry:** equally correct, removes positional
   assumption entirely; slightly more module state for no current need.
3. **Flat re-render from a state model:** rewrite; YAGNI for a single-toggle bug.

## Regression test

Extend `src/__tests__/tree.test.ts` with a jsdom DOM test
(`// @vitest-environment jsdom`, pattern already used by `render.test.ts`):

- Stub `initTree` hooks with a fake `listDir` whose listing has a subdirectory
  followed by another entry (the v0.7.0 blind spot), e.g. root contains
  `[alpha/ (dir), keep.typ (file)]` and `alpha/` contains `[b.typ, c.typ]`.
- `renderTreeRoot`, then click the `alpha` row.
- Assert: `keep.typ` row still exists with its label intact and contains no
  `.tree-row` children; `alpha`'s children render in a dedicated sibling
  container; clicking `b.typ` fires `onOpen` with `b.typ`'s path (not
  `keep.typ`'s); collapsing `alpha` leaves `keep.typ` present.

Test must fail on current `main` and pass after the fix (TDD: written first).

## Verification

- `npm test` (Vitest), new regression test plus existing suite.
- No Rust changes: `cargo test` unaffected (CI parity optional).

## Out of scope

- The `nextElementSibling`-between-row-and-box insertion-window race (rapid
  double-click on a loading dir fills a detached box; self-heals on next expand).
- Tree caching/watchers (per `2026-09-30-workspace-tree-scope-decision.md`).

## Versioning

Canonical source `src-tauri/tauri.conf.json`. Bug fix on shipped behavior →
patch bump to `0.7.1` at close-out (sync `package.json`, `src-tauri/Cargo.toml`),
plus a `Fixed` entry under `[Unreleased]`/`0.7.1` in `CHANGELOG.md`.
