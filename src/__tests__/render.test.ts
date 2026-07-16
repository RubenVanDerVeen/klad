// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../render";

describe("renderMarkdown", () => {
  it("renders GFM tables", () => {
    const html = renderMarkdown("|a|b|\n|-|-|\n|1|2|");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders task lists as disabled checkboxes", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
  });

  it("strips script tags", () => {
    const html = renderMarkdown("hi <script>alert(1)</script>");
    expect(html).not.toContain("<script");
  });

  it("strips event handler attributes", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconst a = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("const a = 1;");
  });

  it("renders headings and inline code", () => {
    const html = renderMarkdown("# Title\n\n`code`");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<code>code</code>");
  });
});
