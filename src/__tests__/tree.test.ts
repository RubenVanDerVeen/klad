// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { initTree, renderTreeRoot, sortEntries, visibleEntries, type TreeEntry } from "../tree";

const e = (name: string, isDir: boolean): TreeEntry => ({ name, path: `/${name}`, isDir });

describe("sortEntries", () => {
  it("dirs first, case-insensitive", () => {
    expect(sortEntries([e("B.txt", false), e("zdir", true), e("a.txt", false), e("Adir", true)])
      .map((x) => x.name)).toEqual(["Adir", "zdir", "a.txt", "B.txt"]);
  });
});

describe("visibleEntries", () => {
  it("drops dotfiles", () => {
    expect(visibleEntries([e(".git", true), e("main.typ", false)]).map((x) => x.name))
      .toEqual(["main.typ"]);
  });
});

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
