export interface DocMeta {
  path: string | null;
  encoding: string;
  eol: "LF" | "CRLF";
  dirty: boolean;
}

export function defaultEol(
  ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
): "LF" | "CRLF" {
  return ua.includes("Windows") ? "CRLF" : "LF";
}

export function newDoc(): DocMeta {
  return { path: null, encoding: "UTF-8", eol: defaultEol(), dirty: false };
}

export function fileName(meta: DocMeta): string {
  if (!meta.path) return "Untitled";
  return meta.path.split(/[\\/]/).pop() || "Untitled";
}

export function windowTitle(meta: DocMeta): string {
  return `${meta.dirty ? "*" : ""}${fileName(meta)} - Klad`;
}
