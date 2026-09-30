// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  collectOverrides, relPathUnder, parseWorkspace,
  saveWorkspace, clearWorkspace, loadWorkspace,
} from "../workspace";

describe("parseWorkspace", () => {
  it("accepts {root}", () => {
    expect(parseWorkspace(JSON.stringify({ root: "/tmp/p" }))).toEqual({ root: "/tmp/p" });
  });
  it("rejects junk", () => {
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace("{")).toBeNull();
    expect(parseWorkspace(JSON.stringify({ root: 3 }))).toBeNull();
    expect(parseWorkspace(JSON.stringify({}))).toBeNull();
  });
});

describe("relPathUnder", () => {
  it("returns forward-slash relpath", () => {
    expect(relPathUnder("/a/b", "/a/b/c/d.typ")).toBe("c/d.typ");
  });
  it("normalizes windows separators", () => {
    expect(relPathUnder("C:\\proj", "C:\\proj\\sub\\l.typ")).toBe("sub/l.typ");
  });
  it("null outside root and for root itself", () => {
    expect(relPathUnder("/a/b", "/a/x/d.typ")).toBeNull();
    expect(relPathUnder("/a/b", "/a/b")).toBeNull();
    expect(relPathUnder("/a/b", "/a/b2/c.typ")).toBeNull();
  });
});

describe("collectOverrides", () => {
  const root = "/r";
  it("takes dirty files under root, excludes active", () => {
    expect(collectOverrides([
      { path: "/r/lib.typ", dirty: true, text: "live" },
      { path: "/r/clean.typ", dirty: false, text: "stale" },
      { path: "/r/main.typ", dirty: true, text: "entry" },
      { path: "/elsewhere/x.typ", dirty: true, text: "out" },
      { path: null, dirty: true, text: "untitled" },
    ], root, "/r/main.typ")).toEqual({ "lib.typ": "live" });
  });
});

describe("localStorage round-trip", () => {
  beforeEach(() => localStorage.clear());
  it("saves, loads, clears", () => {
    saveWorkspace("/w");
    expect(loadWorkspace()).toEqual({ root: "/w" });
    clearWorkspace();
    expect(loadWorkspace()).toBeNull();
  });
});
