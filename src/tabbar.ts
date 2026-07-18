export interface TabView {
  id: string;
  label: string;
  dirty: boolean;
  active: boolean;
}

export interface TabBarHooks {
  onSwitch(id: string): void;
  onClose(id: string): void;
  onNew(): void;
}

let bar: HTMLElement;
let newBtn: HTMLButtonElement;
const hooks: TabBarHooks = {
  onSwitch: () => {},
  onClose: () => {},
  onNew: () => {},
};

export function initTabBar(h: TabBarHooks): void {
  hooks.onSwitch = h.onSwitch;
  hooks.onClose = h.onClose;
  hooks.onNew = h.onNew;
  bar = document.getElementById("tabbar")!;
  bar.innerHTML = "";
  newBtn = document.createElement("button");
  newBtn.id = "new-tab";
  newBtn.type = "button";
  newBtn.title = "New tab (Ctrl+N)";
  newBtn.textContent = "+";
  newBtn.onclick = () => hooks.onNew();
  bar.appendChild(newBtn);
}

export function renderTabs(views: TabView[]): void {
  for (const el of Array.from(bar.querySelectorAll(".tab"))) el.remove();
  for (const v of views) {
    const t = document.createElement("div");
    t.className = "tab" + (v.active ? " active" : "");
    t.dataset.id = v.id;
    t.dataset.dirty = v.dirty ? "true" : "false";

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = v.label;
    t.appendChild(label);

    const dot = document.createElement("span");
    dot.className = "tab-dot";
    t.appendChild(dot);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.title = "Close (Ctrl+W)";
    close.textContent = "\u00d7";
    close.onclick = (e) => {
      e.stopPropagation();
      hooks.onClose(v.id);
    };
    t.appendChild(close);

    t.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".tab-close")) return;
      hooks.onSwitch(v.id);
    });
    t.addEventListener("auxclick", (e) => {
      if ((e as MouseEvent).button === 1) hooks.onClose(v.id);
    });

    bar.insertBefore(t, newBtn);
  }
}
