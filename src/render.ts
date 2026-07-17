import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdown(text: string): string {
  let html: string;
  try {
    html = marked.parse(text, { async: false }) as string;
  } catch {
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    html = `<pre>${escaped}</pre>`;
  }
  return DOMPurify.sanitize(html);
}
