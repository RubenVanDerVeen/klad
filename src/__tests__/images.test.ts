// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset:${p}`,
  invoke: vi.fn(),
}));

import { dirName, resolveImageSrc, resolveImages } from "../images";

describe("dirName", () => {
  it("splits windows and posix paths", () => {
    expect(dirName("C:\\Users\\ruben\\docs\\note.md")).toBe("C:/Users/ruben/docs");
    expect(dirName("/home/ruben/docs/note.md")).toBe("/home/ruben/docs");
  });
});

describe("resolveImageSrc", () => {
  const base = "C:/Users/ruben/docs";

  it("rewrites relative paths against baseDir", () => {
    expect(resolveImageSrc(".media/pic.png", base)).toBe("asset:C:/Users/ruben/docs/.media/pic.png");
    expect(resolveImageSrc("sub\\pic.png", base)).toBe("asset:C:/Users/ruben/docs/sub/pic.png");
  });

  it("passes absolute urls and schemes through untouched", () => {
    expect(resolveImageSrc("https://x.test/a.png", base)).toBe("https://x.test/a.png");
    expect(resolveImageSrc("data:image/png;base64,AAAA", base)).toBe("data:image/png;base64,AAAA");
    expect(resolveImageSrc("/abs/path.png", base)).toBe("/abs/path.png");
    expect(resolveImageSrc("D:\\other\\pic.png", base)).toBe("D:\\other\\pic.png");
  });

  it("is a no-op without a base dir", () => {
    expect(resolveImageSrc("pic.png", null)).toBe("pic.png");
  });
});

describe("resolveImages", () => {
  it("rewrites img src in a container", () => {
    document.body.innerHTML = '<img src="pic.png"><img src="https://x.test/a.png">';
    resolveImages(document.body, "C:/docs");
    const imgs = document.querySelectorAll("img");
    expect(imgs[0]!.getAttribute("src")).toBe("asset:C:/docs/pic.png");
    expect(imgs[1]!.getAttribute("src")).toBe("https://x.test/a.png");
  });

  it("is a no-op without a base dir", () => {
    document.body.innerHTML = '<img src="pic.png">';
    resolveImages(document.body, null);
    expect(document.querySelector("img")!.getAttribute("src")).toBe("pic.png");
  });
});