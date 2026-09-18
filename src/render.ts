import DOMPurify from "dompurify";
import katex from "katex";
import { marked, type TokenizerAndRendererExtension } from "marked";
import markedKatex from "marked-katex-extension";

marked.setOptions({ gfm: true, breaks: false });

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
    const latex = src.slice(open.length, closeIdx);
    if (latex.length === 0) return undefined;
    if (/[$\n]/.test(latex.replace(/\\\$/g, ""))) return undefined;
    if (/^\s|\s$/.test(latex)) return undefined;
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
