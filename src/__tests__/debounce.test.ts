// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { debounce } from "../preview";

describe("debounce", () => {
  it("collapses rapid calls into the last one", () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const fn = debounce((s: string) => calls.push(s), 150);
    fn("a");
    fn("b");
    fn("c");
    vi.advanceTimersByTime(149);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(calls).toEqual(["c"]);
    vi.useRealTimers();
  });
});
