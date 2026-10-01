import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const svgPath = fileURLToPath(new URL("../public/skillflux-mark.svg", import.meta.url));
const svg = readFileSync(svgPath);

// Generate 16x16 favicon
await sharp(svg, { density: 300 }).resize(16, 16).png().toFile(
  fileURLToPath(new URL("../public/favicon-16.png", import.meta.url))
);

// Generate 32x32 favicon
await sharp(svg, { density: 300 }).resize(32, 32).png().toFile(
  fileURLToPath(new URL("../public/favicon-32.png", import.meta.url))
);

// Generate 180x180 apple-touch-icon
await sharp(svg, { density: 300 }).resize(180, 180).png().toFile(
  fileURLToPath(new URL("../public/apple-touch-icon.png", import.meta.url))
);

console.log("Successfully generated favicon-16.png, favicon-32.png, and apple-touch-icon.png from skillflux-mark.svg");
