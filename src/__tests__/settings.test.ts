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

  it("defaults theme to light", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("light");
    expect(parseSettings(null).theme).toBe("light");
  });

  it("accepts theme: 'dark'", () => {
    expect(parseSettings('{"theme":"dark"}').theme).toBe("dark");
  });

  it("rejects unknown theme strings", () => {
    expect(parseSettings('{"theme":"purple"}').theme).toBe("light");
    expect(parseSettings('{"theme":""}').theme).toBe("light");
  });

  it("rejects wrong-typed theme values", () => {
    expect(parseSettings('{"theme":123}').theme).toBe("light");
    expect(parseSettings('{"theme":null}').theme).toBe("light");
    expect(parseSettings('{"theme":true}').theme).toBe("light");
  });

  it("preserves theme through round-trip save→load", () => {
    const dark = { ...DEFAULT_SETTINGS, theme: "dark" as const };
    const roundTrip = parseSettings(JSON.stringify(dark));
    expect(roundTrip.theme).toBe("dark");
    expect(roundTrip).toEqual(dark);
  });
});
