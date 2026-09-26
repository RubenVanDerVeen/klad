import { describe, it, expect } from "vitest";
import { parseCsv, sniffDelimiter } from "../csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\nd,e,f", ",")).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  it("treats CRLF as a row terminator", () => {
    expect(parseCsv("a,b\r\nc,d", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("trailing newline does not create an empty row", () => {
    expect(parseCsv("a,b\n", ",")).toEqual([["a", "b"]]);
  });

  it("parses quoted fields with commas, newlines and escaped quotes", () => {
    expect(parseCsv('a,"x,y","li""ne"\n"multi\nline",b', ",")).toEqual([
      ["a", "x,y", 'li"ne'],
      ["multi\nline", "b"],
    ]);
  });

  it("keeps empty fields and empty rows", () => {
    expect(parseCsv("a,,c\n\nd,e", ",")).toEqual([
      ["a", "", "c"],
      [""],
      ["d", "e"],
    ]);
  });

  it("keeps a trailing empty field after a final delimiter", () => {
    expect(parseCsv("a,b,", ",")).toEqual([["a", "b", ""]]);
  });

  it("is lenient on unclosed quotes (consumes to EOF, never throws)", () => {
    expect(parseCsv('a,"unclosed', ",")).toEqual([["a", "unclosed"]]);
  });

  it("supports alternate delimiters", () => {
    expect(parseCsv("a;b\nc;d", ";")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseCsv("", ",")).toEqual([]);
  });
});

describe("sniffDelimiter", () => {
  it("picks semicolon when it dominates", () => {
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
  });
  it("picks tab when it dominates", () => {
    expect(sniffDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
  it("defaults to comma", () => {
    expect(sniffDelimiter("a b c\n1 2 3")).toBe(",");
  });
  it("ignores separators inside quotes", () => {
    expect(sniffDelimiter('"a;b",c\n"1;2",3')).toBe(",");
  });
  it("sniffs from the first non-empty line", () => {
    expect(sniffDelimiter("\n\na|b\n1,2")).toBe("|");
  });
});