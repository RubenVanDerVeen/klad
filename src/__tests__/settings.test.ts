import { describe, expect, it } from "vitest";
import { clampZoom, DEFAULT_SETTINGS, parseSettings } from "../settings";

describe("settings", () => {
  it("null/corrupt/partial input falls back to defaults", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"zoom":150}')).toEqual({ ...DEFAULT_SETTINGS, zoom: 150 });
  });

  it("ignores junk keys and wrong types", () => {
    expect(parseSettings('{"zoom":"big","evil":1}')).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps zoom to 10-500", () => {
    expect(clampZoom(5)).toBe(10);
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(9000)).toBe(500);
  });
});
