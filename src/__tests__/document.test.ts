import { describe, expect, it } from "vitest";
import { defaultEol, fileName, newDoc, windowTitle } from "../document";

describe("document model", () => {
  it("new doc is untitled, clean, UTF-8", () => {
    const d = newDoc();
    expect(d.path).toBeNull();
    expect(d.dirty).toBe(false);
    expect(d.encoding).toBe("UTF-8");
  });

  it("defaultEol is CRLF on Windows, LF elsewhere", () => {
    expect(defaultEol("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("CRLF");
    expect(defaultEol("Mozilla/5.0 (X11; Linux x86_64)")).toBe("LF");
  });

  it("fileName handles windows and unix paths, and untitled", () => {
    expect(fileName({ ...newDoc(), path: "C:\\notes\\todo.txt" })).toBe("todo.txt");
    expect(fileName({ ...newDoc(), path: "/home/ruben/todo.md" })).toBe("todo.md");
    expect(fileName(newDoc())).toBe("Untitled");
  });

  it("windowTitle marks dirty docs with *", () => {
    const d = { ...newDoc(), path: "C:\\a\\b.txt" };
    expect(windowTitle(d)).toBe("b.txt - Klad");
    expect(windowTitle({ ...d, dirty: true })).toBe("*b.txt - Klad");
  });
});
