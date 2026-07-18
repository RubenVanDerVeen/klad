import { describe, expect, it } from "vitest";
import { extractPaths } from "../fileio";

describe("extractPaths", () => {
  it("returns argv[1..] when argv is a string array", () => {
    const payload = { argv: ["klad", "/a.txt", "/b.md"], cwd: "/tmp" };
    expect(extractPaths(payload)).toEqual(["/a.txt", "/b.md"]);
  });

  it("returns [] when only argv[0] (the executable) is present", () => {
    expect(extractPaths({ argv: ["klad"], cwd: "/tmp" })).toEqual([]);
  });

  it("returns [] when argv is empty", () => {
    expect(extractPaths({ argv: [], cwd: "/tmp" })).toEqual([]);
  });

  it("rejects non-array argv", () => {
    expect(extractPaths({ argv: "klad", cwd: "/tmp" })).toEqual([]);
    expect(extractPaths({ argv: null, cwd: "/tmp" })).toEqual([]);
    expect(extractPaths({ cwd: "/tmp" })).toEqual([]);
  });

  it("rejects argv with non-string elements", () => {
    expect(extractPaths({ argv: ["klad", 42, "/b.md"], cwd: "/tmp" })).toEqual([]);
  });

  it("treats non-object payloads as no-op", () => {
    expect(extractPaths(null)).toEqual([]);
    expect(extractPaths(undefined)).toEqual([]);
    expect(extractPaths("not an object")).toEqual([]);
    expect(extractPaths(123)).toEqual([]);
  });
});
