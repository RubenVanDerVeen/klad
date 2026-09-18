import { convertFileSrc } from "@tauri-apps/api/core";

/** Directory part of a file path, forward-slashed (Windows-safe). */
export function dirName(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/");
}

/** Rewrite a markdown img src against the document's directory. Relative
 *  paths only; urls, data/asset schemes, and absolute paths pass through. */
export function resolveImageSrc(raw: string, baseDir: string | null): string {
  if (!baseDir || !raw) return raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw; // http(s):, data:, asset:, C:\
  if (raw.startsWith("/") || raw.startsWith("\\")) return raw;
  const base = baseDir.replace(/[\\/]+$/, "");
  // ponytail: normalize internal backslashes too so Windows-relative refs ("sub\pic.png")
  // produce a forward-slash asset URL. Upgrade to URL if percent-encoding or UNC paths matter.
  const rel = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  return convertFileSrc(`${base}/${rel}`);
}

/** DOM pass: rewrite every img[src] under root (call before mounting rich blocks). */
export function resolveImages(root: ParentNode, baseDir: string | null): void {
  if (!baseDir) return;
  root.querySelectorAll("img").forEach((img) => {
    const raw = img.getAttribute("src") ?? "";
    if (raw) img.setAttribute("src", resolveImageSrc(raw, baseDir));
  });
}