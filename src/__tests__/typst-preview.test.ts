import { describe, it, expect } from "vitest";
import { pickRender } from "../preview";

// previewKindForPath stays local here (it mirrors src/main.ts's isMarkdown/isTypst
// derivation; main.ts doesn't export it). The contract under test is the
// extension-to-kind mapping itself.
function previewKindForPath(path: string | null): "md" | "typ" | null {
  if (/\.(md|markdown)$/i.test(path ?? "")) return "md";
  if (/\.(typ|typst)$/i.test(path ?? "")) return "typ";
  return null;
}

describe("typst render race guard", () => {
  it("applies when the token is still the latest", () => {
    expect(pickRender(5, 5)).toBe(true);
  });

  it("drops when a newer render has started", () => {
    expect(pickRender(5, 7)).toBe(false);
  });

  it("drops when interleaved out of order (slow then fast)", () => {
    // Simulate: token 1 starts (slow), token 2 starts+finishes fast (latest=2),
    // then token 1's result arrives — must drop.
    expect(pickRender(1, 2)).toBe(false);
  });
});

describe("previewKindForPath", () => {
  it("detects markdown", () => {
    expect(previewKindForPath("foo.md")).toBe("md");
    expect(previewKindForPath("foo.markdown")).toBe("md");
    expect(previewKindForPath("foo.MD")).toBe("md"); // case-insensitive
  });

  it("detects typst", () => {
    expect(previewKindForPath("foo.typ")).toBe("typ");
    expect(previewKindForPath("foo.typst")).toBe("typ");
    expect(previewKindForPath("foo.TYP")).toBe("typ"); // case-insensitive
  });

  it("returns null for non-previewable files", () => {
    expect(previewKindForPath("foo.txt")).toBeNull();
    expect(previewKindForPath("foo.log")).toBeNull();
    expect(previewKindForPath(null)).toBeNull();
    expect(previewKindForPath("")).toBeNull();
  });

  it("does not confuse .typst with other dotfiles", () => {
    // .typst.bak is not a typst file — extension must be exactly .typ or .typst
    expect(previewKindForPath("foo.typst.bak")).toBeNull();
  });
});
