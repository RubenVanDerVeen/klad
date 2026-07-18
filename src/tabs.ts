import { DocMeta } from "./document";

export interface TabState {
  id: string;
  meta: DocMeta;
  /** Present only when persisting a dirty untitled buffer to localStorage. */
  unsavedText?: string;
}

export interface TabCollection {
  tabs: TabState[];
  activeId: string | null;
}

let counter = 0;
export function genId(): string {
  counter += 1;
  return `t${counter}`;
}

export function newCollection(): TabCollection {
  return { tabs: [], activeId: null };
}

export function openTab(coll: TabCollection, tab: TabState): TabCollection {
  return { tabs: [...coll.tabs, tab], activeId: tab.id };
}

export function closeTab(coll: TabCollection, id: string): TabCollection {
  const idx = coll.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return coll;
  const tabs = coll.tabs.filter((t) => t.id !== id);
  // Closing a non-active tab leaves the active id alone.
  if (coll.activeId !== id) {
    return { tabs, activeId: coll.activeId };
  }
  // Closed the active tab: next sibling, else previous (when closing last), else null.
  let activeId: string | null = null;
  if (tabs.length > 0) {
    const nextIdx = Math.min(idx, tabs.length - 1);
    activeId = tabs[nextIdx].id;
  }
  return { tabs, activeId };
}

export function switchTab(coll: TabCollection, id: string): TabCollection {
  if (coll.activeId === id) return coll;
  if (!coll.tabs.some((t) => t.id === id)) return coll;
  return { ...coll, activeId: id };
}

export function findTabByPath(coll: TabCollection, path: string): TabState | null {
  return coll.tabs.find((t) => t.meta.path === path) ?? null;
}

export function nextTab(coll: TabCollection): TabCollection {
  if (coll.tabs.length < 2 || !coll.activeId) return coll;
  const idx = coll.tabs.findIndex((t) => t.id === coll.activeId);
  if (idx === -1) return coll;
  return { ...coll, activeId: coll.tabs[(idx + 1) % coll.tabs.length].id };
}

export function prevTab(coll: TabCollection): TabCollection {
  if (coll.tabs.length < 2 || !coll.activeId) return coll;
  const idx = coll.tabs.findIndex((t) => t.id === coll.activeId);
  if (idx === -1) return coll;
  const n = coll.tabs.length;
  return { ...coll, activeId: coll.tabs[(idx - 1 + n) % n].id };
}