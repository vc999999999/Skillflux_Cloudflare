import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const svgPath = fileURLToPath(new URL("./og-image.svg", import.meta.url));
const outPath = fileURLToPath(new URL("../public/og.png", import.meta.url));
const svg = readFileSync(svgPath);
await sharp(svg, { density: 200 }).resize(1200, 630).png().toFile(outPath);
console.log("wrote", outPath);
