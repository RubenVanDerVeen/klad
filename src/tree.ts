export interface TreeEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface TreeHooks {
  onOpen(path: string): void;
  listDir(path: string): Promise<TreeEntry[]>;
}

let hooks: TreeHooks | null = null;

export function initTree(h: TreeHooks): void {
  hooks = h;
}

export function clearTree(): void {
  document.getElementById("tree")?.replaceChildren();
}

export function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0;
  });
}

export function visibleEntries(entries: TreeEntry[]): TreeEntry[] {
  return entries.filter((e) => !e.name.startsWith("."));
}

const basename = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

export async function renderTreeRoot(root: string): Promise<void> {
  const title = document.getElementById("sidebar-title");
  const tree = document.getElementById("tree");
  if (!tree) return;
  if (title) title.textContent = basename(root);
  tree.replaceChildren();
  const row = rowFor({ name: basename(root), path: root, isDir: true }, 0);
  row.classList.add("tree-root");
  tree.append(row);
  await toggleDir(row, root, 0); // start expanded
}

function rowFor(entry: TreeEntry, depth: number): HTMLElement {
  const row = document.createElement("div");
  row.className = entry.isDir ? "tree-row tree-dir" : "tree-row tree-file";
  row.dataset.name = entry.name;
  row.dataset.path = entry.path;
  row.style.paddingLeft = `${8 + depth * 14}px`;
  row.textContent = entry.isDir ? `▸ ${entry.name}` : entry.name;
  if (entry.isDir) row.addEventListener("click", () => void toggleDir(row, entry.path, depth));
  else row.addEventListener("click", () => hooks?.onOpen(entry.path));
  return row;
}

// ponytail: no caching, no fs watching — every expand re-lists, external changes self-heal.
async function toggleDir(row: HTMLElement, path: string, depth: number): Promise<void> {
  if (!hooks) return;
  let box = row.nextElementSibling as HTMLElement | null;
  if (row.dataset.open === "true") {
    row.dataset.open = "false";
    row.textContent = `▸ ${row.dataset.name}`;
    box?.remove();
    return;
  }
  row.dataset.open = "true";
  row.textContent = `▾ ${row.dataset.name}`;
  if (!box) {
    box = document.createElement("div");
    row.after(box);
  }
  box.replaceChildren(Object.assign(document.createElement("div"), { className: "tree-row tree-error", textContent: "…" }));
  try {
    const entries = sortEntries(visibleEntries(await hooks.listDir(path)));
    box.replaceChildren(...entries.map((e) => rowFor(e, depth + 1)));
  } catch {
    box.replaceChildren(Object.assign(document.createElement("div"), { className: "tree-row tree-error", textContent: "cannot list" }));
  }
}