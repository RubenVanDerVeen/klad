import { describe, expect, it } from "vitest";
import { DocMeta } from "../document";
import { openTab, switchTab, newCollection, TabState } from "../tabs";
import { parseSession, Session, toSession } from "../session";

function tab(path: string | null, id: string, dirty = false, unsavedText?: string): TabState {
  const meta: DocMeta = { path, encoding: "UTF-8", eol: "LF", dirty };
  return { id, meta, unsavedText };
}

describe("session parsing", () => {
  it("returns null for absent/corrupt input", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("not json")).toBeNull();
    expect(parseSession("{}")).toBeNull(); // no entries
    expect(parseSession('{"entries":[]}')).toBeNull();
    expect(parseSession('{"entries":"nope"}')).toBeNull();
    expect(parseSession('{"entries":[123]}')).toBeNull(); // entry not an object
  });

  it("drops clean untitled entries (path null, no text)", () => {
    const s = parseSession('{"entries":[{"path":null,"encoding":"UTF-8","eol":"LF"}]}');
    expect(s).toBeNull(); // all entries dropped => no session
  });

  it("keeps dirty untitled entries (path null, text present)", () => {
    const raw = '{"entries":[{"path":null,"encoding":"UTF-8","eol":"LF","text":"hi"}],"activeIndex":0}';
    const s = parseSession(raw);
    expect(s?.entries).toHaveLength(1);
    expect(s?.entries[0].text).toBe("hi");
    expect(s?.activeIndex).toBe(0);
  });

  it("rejects entries with wrong-typed fields", () => {
    const raw = '{"entries":[{"path":"/a","encoding":123,"eol":"LF"}]}';
    expect(parseSession(raw)).toBeNull();
  });

  it("rejects entries with bad eol", () => {
    const raw = '{"entries":[{"path":"/a","encoding":"UTF-8","eol":"CR"}]}';
    expect(parseSession(raw)).toBeNull();
  });

  it("clamps activeIndex into range", () => {
    const raw = '{"entries":[{"path":"/a","encoding":"UTF-8","eol":"LF"}],"activeIndex":99}';
    const s = parseSession(raw);
    expect(s?.activeIndex).toBe(0);
  });

  it("clamps negative activeIndex to 0", () => {
    const raw = '{"entries":[{"path":"/a","encoding":"UTF-8","eol":"LF"}],"activeIndex":-3}';
    const s = parseSession(raw);
    expect(s?.activeIndex).toBe(0);
  });

  it("round-trips a representative session", () => {
    let coll = newCollection();
    coll = openTab(coll, tab("/a.txt", "t1"));
    coll = openTab(coll, tab(null, "t2", true, "unsaved edits"));
    coll = openTab(coll, tab("/b.md", "t3"));
    coll = switchTab(coll, "t3");
    const s = toSession(coll);
    const json = JSON.stringify(s);
    const back = parseSession(json);
    expect(back).toEqual(s);
  });

  it("toSession persists text for all dirty tabs (titled or untitled)", () => {
    let coll = newCollection();
    coll = openTab(coll, tab(null, "t1", false));                       // clean untitled
    coll = openTab(coll, tab(null, "t2", true, "untitled-edits"));      // dirty untitled
    coll = openTab(coll, tab("/x.txt", "t3", true, "named-edits"));     // dirty named
    coll = openTab(coll, tab("/y.txt", "t4", false));                   // clean named
    const s = toSession(coll);
    expect(s.entries[0].text).toBeUndefined(); // clean untitled
    expect(s.entries[1].text).toBe("untitled-edits");
    expect(s.entries[2].text).toBe("named-edits"); // NEW: dirty named now persists
    expect(s.entries[3].text).toBeUndefined(); // clean named
  });

  it("round-trips a dirty named buffer with its unsaved text", () => {
    let coll = newCollection();
    coll = openTab(coll, tab("/notes.md", "t1", true, "unsaved markdown"));
    coll = switchTab(coll, "t1");
    const s = toSession(coll);
    const back = parseSession(JSON.stringify(s));
    expect(back).toEqual(s);
    expect(back?.entries[0].path).toBe("/notes.md");
    expect(back?.entries[0].text).toBe("unsaved markdown");
  });
});
