import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const png = await sharp("icon.svg").resize(1024, 1024).png().toBuffer();
await writeFile("app-icon.png", png);
const meta = await sharp("app-icon.png").metadata();
if (meta.width !== 1024 || meta.height !== 1024) {
  throw new Error(`icon is ${meta.width}x${meta.height}, expected 1024x1024`);
}
console.log("app-icon.png ok (1024x1024)");