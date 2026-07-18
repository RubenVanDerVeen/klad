import { TabCollection } from "./tabs";

export interface SessionEntry {
  path: string | null;
  encoding: string;
  eol: "LF" | "CRLF";
  /** Present only for untitled dirty buffers being persisted. */
  text?: string;
}

export interface Session {
  entries: SessionEntry[];
  activeIndex: number;
}

const KEY = "klad-session";

export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.entries)) return null;

  const entries: SessionEntry[] = [];
  for (const e of obj.entries) {
    if (typeof e !== "object" || e === null) continue;
    const eo = e as Record<string, unknown>;
    if (eo.path !== null && typeof eo.path !== "string") continue;
    if (typeof eo.encoding !== "string") continue;
    if (eo.eol !== "LF" && eo.eol !== "CRLF") continue;
    const text = typeof eo.text === "string" ? eo.text : undefined;
    // Drop clean untitled tabs (no path AND no text).
    if (eo.path === null && text === undefined) continue;
    const entry: SessionEntry = {
      path: eo.path as string | null,
      encoding: eo.encoding,
      eol: eo.eol,
    };
    if (text !== undefined) entry.text = text;
    entries.push(entry);
  }
  if (entries.length === 0) return null;

  let activeIndex =
    typeof obj.activeIndex === "number" && Number.isFinite(obj.activeIndex)
      ? Math.floor(obj.activeIndex)
      : 0;
  if (activeIndex < 0) activeIndex = 0;
  if (activeIndex > entries.length - 1) activeIndex = entries.length - 1;
  return { entries, activeIndex };
}

export function loadSession(): Session | null {
  try {
    return parseSession(
      typeof localStorage === "undefined" ? null : localStorage.getItem(KEY),
    );
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // best-effort: storage unavailable or full
  }
}

export function toSession(coll: TabCollection): Session {
  const entries: SessionEntry[] = coll.tabs.map((t) => {
    const entry: SessionEntry = {
      path: t.meta.path,
      encoding: t.meta.encoding,
      eol: t.meta.eol,
    };
    // Persist text only for untitled dirty buffers (caller sets unsavedText).
    if (t.meta.path === null && t.meta.dirty) {
      entry.text = t.unsavedText ?? "";
    }
    return entry;
  });
  const activeIdx = coll.activeId
    ? coll.tabs.findIndex((t) => t.id === coll.activeId)
    : -1;
  return { entries, activeIndex: Math.max(0, activeIdx) };
}
