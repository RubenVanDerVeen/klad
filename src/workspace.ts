const KEY = "klad-workspace";

export interface WorkspaceState {
  root: string;
}

export function parseWorkspace(raw: string | null): WorkspaceState | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && typeof (v as { root?: unknown }).root === "string"
        && (v as { root: string }).root !== "") {
      return { root: (v as { root: string }).root };
    }
  } catch {
    /* invalid JSON -> null */
  }
  return null;
}

export function loadWorkspace(): WorkspaceState | null {
  try {
    return parseWorkspace(
      typeof localStorage === "undefined" ? null : localStorage.getItem(KEY),
    );
  } catch {
    return null;
  }
}

export function saveWorkspace(root: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify({ root }));
  } catch {
    // best-effort: storage unavailable or full
  }
}

export function clearWorkspace(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(KEY);
  } catch {
    // best-effort: storage unavailable
  }
}

/** Forward-slash relpath of `path` under `root`; null when outside (or equal to root). */
export function relPathUnder(root: string, path: string): string | null {
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const p = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!p.startsWith(`${r}/`)) return null;
  return p.slice(r.length + 1);
}

export interface OverrideEntry {
  path: string | null;
  dirty: boolean;
  text: string;
}

export function collectOverrides(
  entries: OverrideEntry[],
  root: string,
  excludePath?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.dirty || entry.path === null || entry.path === excludePath) continue;
    const rel = relPathUnder(root, entry.path);
    if (rel !== null) out[rel] = entry.text;
  }
  return out;
}
