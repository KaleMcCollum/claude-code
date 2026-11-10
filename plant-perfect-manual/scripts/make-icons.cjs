// Draws the placeholder app icons (dark teal square, white "PP").
// Replace the files it writes with the real Plant Perfect logo when available.
// Run with: node scripts/make-icons.cjs   (needs Playwright's Chromium)
const { chromium } = require("playwright");

(async () => {
const targets = [
  { file: "public/icons/icon-192.png", size: 192, scale: 0.5 },
  { file: "public/icons/icon-512.png", size: 512, scale: 0.5 },
  // "Maskable" icons get cropped to a circle on some phones, so the letters sit smaller.
  { file: "public/icons/icon-maskable-512.png", size: 512, scale: 0.38 },
  { file: "src/app/apple-icon.png", size: 180, scale: 0.5 },
  { file: "src/app/icon.png", size: 48, scale: 0.56 },
];

const browser = await chromium.launch();
for (const { file, size, scale } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;width:${size}px;height:${size}px;background:#0f5c5c;display:flex;align-items:center;justify-content:center">
    <span style="color:#fff;font:700 ${Math.round(size * scale)}px/1 Helvetica,Arial,sans-serif;letter-spacing:-0.04em">PP</span></body>`);
  await page.screenshot({ path: file });
  await page.close();
  console.log("wrote", file);
}
await browser.close();
})();
