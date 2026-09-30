import sharp from "sharp";
import { mkdirSync, copyFileSync } from "fs";
import { join } from "path";

const SRC =
  "C:/Users/Cybersecurity/.cursor/projects/c-Digital365-MD-City-Website/assets/c__Users_Cybersecurity_AppData_Roaming_Cursor_User_workspaceStorage_e23b1ce97d97defc8d9e51bc2c908578_images_image-3a04ae8d-cff5-459b-a504-77c7d1449555.png";
const LOGO =
  "C:/Users/Cybersecurity/.cursor/projects/c-Digital365-MD-City-Website/assets/c__Users_Cybersecurity_AppData_Roaming_Cursor_User_workspaceStorage_e23b1ce97d97defc8d9e51bc2c908578_images_image-92124f23-5a06-4f6d-9179-1c2f33ea5530.png";
const OUT = "C:/Digital365/MD-City-Website/public/images";

mkdirSync(OUT, { recursive: true });

const { width: W, height: H } = await sharp(SRC).metadata();
console.log(`source ${W}x${H}`);

function box(x0, y0, x1, y1) {
  const left = Math.max(0, Math.round(W * x0));
  const top = Math.max(0, Math.round(H * y0));
  const width = Math.min(W - left, Math.max(1, Math.round(W * x1) - left));
  const height = Math.min(H - top, Math.max(1, Math.round(H * y1) - top));
  return { left, top, width, height };
}

async function save(name, region, scale = 4) {
  const { left, top, width, height } = region;
  await sharp(SRC)
    .extract({ left, top, width, height })
    .resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      kernel: "lanczos3",
    })
    .jpeg({ quality: 90 })
    .toFile(join(OUT, name));
  console.log(`${name} ${width}x${height}`);
}

// Pixel-tuned from strip map (H=1024)
await save("hero-aerial.jpg", box(0.28, 0.045, 1.0, 0.165), 5);
await save("vision-building.jpg", box(0.3, 0.195, 0.66, 0.305), 5);
await save("vision-film.jpg", box(0.66, 0.195, 1.0, 0.31), 5);
await save("explore-aerial.jpg", box(0.0, 0.33, 1.0, 0.46), 5);
await save("zion-grounds.jpg", box(0.01, 0.46, 0.335, 0.545), 5);
await save("carmel-hill.jpg", box(0.335, 0.46, 0.665, 0.545), 5);
await save("facility.jpg", box(0.665, 0.46, 0.99, 0.545), 5);
await save("historic-hero.jpg", box(0.28, 0.62, 0.62, 0.72), 5);
await save("historic-1.jpg", box(0.62, 0.62, 0.81, 0.69), 5);
await save("historic-2.jpg", box(0.81, 0.62, 1.0, 0.69), 5);
await save("historic-3.jpg", box(0.62, 0.695, 1.0, 0.76), 5);
await save("prosperity.jpg", box(0.25, 0.745, 1.0, 0.81), 5);
await save("visionary.jpg", box(0.0, 0.8, 0.42, 0.875), 5);
await save("final-aerial.jpg", box(0.35, 0.86, 1.0, 0.96), 5);

copyFileSync(LOGO, join(OUT, "logo.png"));
console.log("logo.png copied");
