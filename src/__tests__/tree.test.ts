import { describe, expect, it } from "vitest";
import { sortEntries, visibleEntries, TreeEntry } from "../tree";

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