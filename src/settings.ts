export interface Settings {
  wrap: boolean;
  zoom: number;
  fontFamily: string;
  fontSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  wrap: true,
  zoom: 100,
  fontFamily: "Consolas",
  fontSize: 14,
};

const KEY = "klad-settings";

export function clampZoom(z: number): number {
  return Math.min(500, Math.max(10, z));
}

export function clampFontSize(n: number): number {
  return Math.min(72, Math.max(8, n));
}

export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SETTINGS };
  if (typeof obj.wrap === "boolean") out.wrap = obj.wrap;
  if (typeof obj.zoom === "number") out.zoom = clampZoom(obj.zoom);
  if (typeof obj.fontFamily === "string") out.fontFamily = obj.fontFamily;
  if (typeof obj.fontSize === "number") out.fontSize = clampFontSize(obj.fontSize);
  return out;
}

export function loadSettings(): Settings {
  return parseSettings(
    typeof localStorage === "undefined" ? null : localStorage.getItem(KEY),
  );
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
