import { describe, expect, it } from "vitest";
import { DocMeta } from "../document";
import {
  closeTab,
  findTabByPath,
  genId,
  newCollection,
  nextTab,
  openTab,
  prevTab,
  switchTab,
  TabCollection,
  TabState,
} from "../tabs";

function tab(path: string | null, id: string, dirty = false): TabState {
  const meta: DocMeta = {
    path,
    encoding: "UTF-8",
    eol: "LF",
    dirty,
  };
  return { id, meta };
}

describe("tabs collection", () => {
  it("openTab appends and activates the new tab", () => {
    const c = openTab(newCollection(), tab(null, "t1"));
    expect(c.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(c.activeId).toBe("t1");
  });

  it("closeTab picks the next sibling as active", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    c = openTab(c, tab(null, "t3"));
    c = switchTab(c, "t2");
    c = closeTab(c, "t2");
    expect(c.tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(c.activeId).toBe("t3");
  });

  it("closeTab on the last tab picks the previous sibling", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    c = switchTab(c, "t2");
    c = closeTab(c, "t2");
    expect(c.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(c.activeId).toBe("t1");
  });

  it("closeTab on the only tab yields an empty collection", () => {
    let c = openTab(newCollection(), tab(null, "t1"));
    c = closeTab(c, "t1");
    expect(c.tabs).toEqual([]);
    expect(c.activeId).toBeNull();
  });

  it("closeTab on a non-active tab leaves activeId unchanged", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    c = openTab(c, tab(null, "t3"));
    c = switchTab(c, "t3");
    c = closeTab(c, "t1"); // close a non-active, earlier tab
    expect(c.tabs.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(c.activeId).toBe("t3");
  });

  it("closeTab on an unknown id is a no-op", () => {
    const c = openTab(newCollection(), tab(null, "t1"));
    expect(closeTab(c, "nope")).toBe(c);
  });

  it("switchTab is a no-op for unknown or already-active id", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    const same = switchTab(c, "t2"); // already active
    expect(same).toBe(c);
    const unknown = switchTab(c, "nope");
    expect(unknown).toBe(c);
  });

  it("findTabByPath matches exact path", () => {
    let c = newCollection();
    c = openTab(c, tab("/a/b.txt", "t1"));
    c = openTab(c, tab(null, "t2"));
    expect(findTabByPath(c, "/a/b.txt")?.id).toBe("t1");
    expect(findTabByPath(c, "/nope")).toBeNull();
  });

  it("nextTab and prevTab wrap around", () => {
    let c = newCollection();
    c = openTab(c, tab(null, "t1"));
    c = openTab(c, tab(null, "t2"));
    c = openTab(c, tab(null, "t3"));
    c = switchTab(c, "t1");
    c = prevTab(c);
    expect(c.activeId).toBe("t3");
    c = nextTab(c);
    expect(c.activeId).toBe("t1");
    c = nextTab(c);
    c = nextTab(c);
    expect(c.activeId).toBe("t3");
  });

  it("nextTab/prevTab are no-ops with fewer than 2 tabs", () => {
    const c = openTab(newCollection(), tab(null, "t1"));
    expect(nextTab(c)).toBe(c);
    expect(prevTab(c)).toBe(c);
  });

  it("genId produces distinct ids", () => {
    const ids = new Set([genId(), genId(), genId(), genId()]);
    expect(ids.size).toBe(4);
  });
});
