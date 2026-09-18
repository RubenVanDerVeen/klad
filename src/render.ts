import DOMPurify from "dompurify";
import katex from "katex";
import { marked, type TokenizerAndRendererExtension } from "marked";
import markedKatex from "marked-katex-extension";

marked.setOptions({ gfm: true, breaks: false });

// --- Host extensions (mermaid / plot / columns / sized image) ---
// Sanitized hosts for Task 3 to mount SVGs onto live DOM. The data-src
// attribute carries the raw source; the visible body is escaped.
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const mermaidExtension: TokenizerAndRendererExtension = {
  name: "mermaid",
  level: "block",
  start(src: string) {
    return src.match(/^```mermaid[ \t]*$/mi)?.index;
  },
  tokenizer(src: string) {
    const m = /^```mermaid[ \t]*\n([\s\S]*?)\n```/i.exec(src);
    if (m) return { type: "mermaid", raw: m[0], text: m[1] };
    return undefined;
  },
  renderer(token) {
    const src = String(token.text ?? "");
    return `<div class="mermaid" data-src="${escapeAttr(src)}">${escapeHtml(src)}</div>`;
  },
};

const plotExtension: TokenizerAndRendererExtension = {
  name: "plot",
  level: "block",
  start(src: string) {
    return src.match(/^```plot[ \t]*$/mi)?.index;
  },
  tokenizer(src: string) {
    const m = /^```plot[ \t]*\n([\s\S]*?)\n```/i.exec(src);
    if (m) return { type: "plot", raw: m[0], text: m[1] };
    return undefined;
  },
  renderer(token) {
    const src = String(token.text ?? "");
    return `<div class="plot" data-src="${escapeAttr(src)}">${escapeHtml(src)}</div>`;
  },
};

const columnsExtension: TokenizerAndRendererExtension = {
  name: "columns",
  level: "block",
  start(src: string) {
    return src.match(/^```columns[ \t]*$/mi)?.index;
  },
  tokenizer(src: string) {
    const m = /^```columns[ \t]*\n([\s\S]*?)\n```/i.exec(src);
    if (m) return { type: "columns", raw: m[0], text: m[1] };
    return undefined;
  },
  renderer(token) {
    const body = String(token.text ?? "");
    // Split on every line that is exactly "||" (optional trailing spaces/tabs).
    const parts = body.split(/^\|\|[ \t]*$/m);
    const cols = parts
      .map((p) => `<div class="md-col">${marked.parse(p, { async: false }) as string}</div>`)
      .join("");
    return `<div class="md-columns">${cols}</div>`;
  },
};

const IMG_SIZE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\{(\d{1,3}(?:\.\d+)?)%\}/;

const imageSizeExtension: TokenizerAndRendererExtension = {
  name: "imageSize",
  level: "inline",
  start(src: string) {
    return src.indexOf("![");
  },
  tokenizer(src: string) {
    const m = IMG_SIZE_RE.exec(src);
    if (!m) return undefined;
    const pct = parseFloat(m[3]!);
    if (!(pct > 0 && pct <= 100)) return undefined;
    return { type: "imageSize", raw: m[0], alt: m[1], src: m[2], size: m[3] + "%" };
  },
  renderer(token) {
    const src = String(token.src);
    const alt = String(token.alt);
    const size = String(token.size);
    return (
      `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"` +
      ` style="width:${size}" data-size="${size}">`
    );
  },
};

const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]+?)\n---[ \t]*(?:\n|$)/;
// A line is yaml-ish if it is a `key: value` line or nested/continuation
// content (indented, e.g. list items under a key). The gate keeps plain
// `--- / text / ---` hr separators rendering as before.
const YAML_LINE_RE = /^([A-Za-z_][\w-]*\s*:(\s|$)|\s)/;

const frontmatterExtension: TokenizerAndRendererExtension = {
  name: "frontmatter",
  level: "block",
  tokenizer(src: string) {
    const m = FRONTMATTER_RE.exec(src);
    if (!m) return undefined;
    const lines = m[1].split("\n");
    const hasKey = lines.some((l) => /^[A-Za-z_][\w-]*\s*:(\s|$)/.test(l));
    const ok = lines.every((line) => line === "" || YAML_LINE_RE.test(line)) && hasKey;
    if (!ok) return undefined;
    return { type: "frontmatter", raw: m[0], text: m[1] };
  },
  renderer(token) {
    const rows: Array<[string, string]> = [];
    for (const line of String(token.text ?? "").split("\n")) {
      if (/^\s/.test(line)) {
        const cont = line.trim().replace(/^- /, "");
        if (cont && rows.length > 0) rows[rows.length - 1][1] += " " + cont;
      } else {
        const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
        if (m) rows.push([m[1], m[2]]);
      }
    }
    const trs = rows
      .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
      .join("");
    return `<table class="frontmatter">${trs}</table>`;
  },
};

marked.use({
  extensions: [frontmatterExtension, imageSizeExtension, mermaidExtension, plotExtension, columnsExtension],
});

// --- KaTeX ($...$ inline, $$...$$ block) — ported from hermes-console
// frontend/src/lib/markdown.ts:172-234. marked-katex owns BLOCK math only;
// its inline rule is looser than mathInline below and would render
// adjacency/currency cases the flavor wants literal ("5$ and 6$", "$100$").
const katexExtension = markedKatex({ throwOnError: false }) as unknown as {
  extensions: TokenizerAndRendererExtension[];
};
katexExtension.extensions = katexExtension.extensions.filter(
  (e) => (e as { level?: string }).level !== "inline",
);
marked.use(katexExtension);

// Own inline math rule, shadowing marked-katex's (stripped above, but kept
// as a separate use() for merge order). Pandoc-style guards: opening not
// followed by whitespace, no newline/unescaped $ inside, no edge spaces,
// closing $ not followed by a digit, pure amounts stay literal.
const PURE_AMOUNT_RE = /^\d+([.,]\d+)*$/;

const mathInline: TokenizerAndRendererExtension = {
  name: "mathInline",
  level: "inline",
  start(src: string) {
    for (let i = 0; i < src.length; i++) {
      if (src[i] === "$" && (i === 0 || src[i - 1] !== "\\")) return i;
    }
    return undefined;
  },
  tokenizer(src: string) {
    const open = /^(\${1,2})/.exec(src)?.[1];
    if (!open) return undefined;
    const closeIdx = src.indexOf(open, open.length);
    if (closeIdx < 0) return undefined;
    let latex = src.slice(open.length, closeIdx);
    if (open.length === 2) {
      // Display math: pandoc-style $$ may span lines mid-paragraph.
      latex = latex.trim();
      if (latex.length === 0) return undefined;
    } else {
      if (latex.length === 0) return undefined;
      if (/\n/.test(latex)) return undefined;
      if (/^\s|\s$/.test(latex)) return undefined;
    }
    if (/\$/.test(latex.replace(/\\\$/g, ""))) return undefined;
    if (PURE_AMOUNT_RE.test(latex)) return undefined;
    if (/[0-9]/.test(src.charAt(closeIdx + open.length))) return undefined;
    return {
      type: "mathInline",
      raw: src.slice(0, closeIdx + open.length),
      latex,
      dollars: open.length,
    };
  },
  renderer(token) {
    const latex = String(token.latex ?? "");
    const dollars = Number(token.dollars ?? 1);
    return katex.renderToString(latex, { throwOnError: false, displayMode: dollars === 2 });
  },
};
marked.use({ extensions: [mathInline] });

const SANITIZE_ATTRS = ["target", "data-src", "data-size", "mathvariant", "stretchy", "encoding"];

export function renderMarkdown(text: string): string {
  let html: string;
  try {
    html = marked.parse(text, { async: false }) as string;
  } catch {
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    html = `<pre>${escaped}</pre>`;
  }
  return DOMPurify.sanitize(html, { ADD_ATTR: SANITIZE_ATTRS });
}
