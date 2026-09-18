// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountRichBlocks, mermaidThemeFor, parsePlotSrc } from "../rich-blocks";

describe("parsePlotSrc", () => {
  it("accepts valid function-plot JSON", () => {
    expect(parsePlotSrc('{"data":[{"fn":"x^2"}]}').ok).toBe(true);
  });

  it("rejects trailing commas", () => {
    expect(parsePlotSrc('{"data":[1,]}').ok).toBe(false);
  });

  it("rejects comments and single quotes", () => {
    expect(parsePlotSrc('// c\n{"data":[]}').ok).toBe(false);
    expect(parsePlotSrc("{'data':[]}").ok).toBe(false);
  });

  it("rejects non-object JSON", () => {
    expect(parsePlotSrc('"x"').ok).toBe(false);
    expect(parsePlotSrc("[1,2]").ok).toBe(false);
  });
});

describe("mermaidThemeFor", () => {
  it("maps klad themes to mermaid themes", () => {
    expect(mermaidThemeFor("dark")).toBe("dark");
    expect(mermaidThemeFor("light")).toBe("default");
    expect(mermaidThemeFor(undefined)).toBe("default");
  });
});

describe("mountRichBlocks error path", () => {
  it("marks invalid plot JSON as plot-error without loading function-plot", async () => {
    document.body.innerHTML = '<div class="plot" data-src=\'{"bad": 1,}\'></div>';
    await mountRichBlocks(document.body);
    const node = document.querySelector(".plot")!;
    expect(node.classList.contains("plot-error")).toBe(true);
    expect(node.textContent).toContain('"bad"');
  });
});