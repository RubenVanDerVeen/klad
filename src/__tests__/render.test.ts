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

  it("renders inline math", () => {
    const html = renderMarkdown("Euler: $e^{i\\pi}$");
    expect(html).toContain("katex");
  });

  it("renders block math", () => {
    const html = renderMarkdown("$$\nx^2 - 2\n$$");
    expect(html).toContain("katex-display");
  });

  it("keeps pure currency amounts literal", () => {
    const html = renderMarkdown("costs $100$ today");
    expect(html).not.toContain("katex");
  });

  it("renders math glued to prose", () => {
    const html = renderMarkdown("a$x^2$b");
    expect(html).toContain("katex");
  });

  it("renders display math after text in the same paragraph", () => {
    const html = renderMarkdown("Euler:\n$$\ne^{i\\pi}\n$$");
    expect(html).toContain("Euler:");
    expect(html).toContain("katex-display");
  });

  it("keeps single-dollar math single-line", () => {
    const html = renderMarkdown("a $x\ny$ b");
    expect(html).not.toContain("katex");
  });

  it("emits a mermaid host with visible source", () => {
    const html = renderMarkdown("```mermaid\nflowchart TD\n  A x B\n```");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("flowchart TD");
    expect(html).toContain("data-src="); // no `-->` in source, so DOMPurify keeps it
  });

  it("emits a plot host with escaped JSON", () => {
    const html = renderMarkdown('```plot\n{"data": [{"fn": "x^2"}]}\n```');
    expect(html).toContain('class="plot"');
    expect(html).toContain("data-src=");
    expect(html).toContain("&quot;fn&quot;"); // attr-escaped quotes survive
  });

  it("renders columns split on || separator lines", () => {
    const html = renderMarkdown("```columns\nleft text\n\n||\n\nright text\n```");
    expect(html).toContain('class="md-columns"');
    expect(html).toContain("<p>left text</p>");
    expect(html).toContain("<p>right text</p>");
  });

  it("renders three columns when two separators", () => {
    const html = renderMarkdown("```columns\na\n\n||\n\nb\n\n||\n\nc\n```");
    expect(html.match(/class="md-col"/g)?.length).toBe(3);
  });

  it("renders a separator-less columns fence as one column", () => {
    const html = renderMarkdown("```columns\njust text\n```");
    expect(html).toContain('class="md-col"');
  });

  it("applies percent width to images", () => {
    const html = renderMarkdown("![alt](pic.png){50%}");
    expect(html).toContain('style="width:50%"');
    expect(html).toContain('data-size="50%"');
  });

  it("keeps out-of-range image scale literal", () => {
    const html = renderMarkdown("![alt](pic.png){150%}");
    expect(html).not.toContain("data-size");
  });

  it("still strips scripts with extensions active", () => {
    const html = renderMarkdown("```mermaid\nx\n```\n\n<script>alert(1)</script>");
    expect(html).not.toContain("<script");
  });

  it("renders YAML frontmatter as a table", () => {
    const html = renderMarkdown(
      "---\ntitle: My note\ndate: 2026-09-18\ntags:\n  - klad\n  - rust\n---\n\n# Body",
    );
    expect(html).toContain('<table class="frontmatter">');
    expect(html).toContain("<td>title</td>");
    expect(html).toContain("<td>My note</td>");
    expect(html).toContain("klad");
    expect(html).toContain("rust");
    expect(html).toContain("<h1>Body</h1>");
    expect(html).not.toContain("<h2>title");
  });

  it("keeps indented-only frontmatter bodies as regular markdown", () => {
    const html = renderMarkdown("---\n  just indented prose\n---");
    expect(html).not.toContain("frontmatter");
    expect(html).toContain("just indented prose");
  });

  it("keeps plain hr separators as hr", () => {
    const html = renderMarkdown("---\n\nsome text\n\n---");
    expect(html).toContain("<hr>");
    expect(html).toContain("<p>some text</p>");
    expect(html).not.toContain("frontmatter");
  });
});
