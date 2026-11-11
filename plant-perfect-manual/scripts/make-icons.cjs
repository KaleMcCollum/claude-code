// Draws the app's icons (phone home screen, browser tab) from the Plant
// Perfect mark: the green P with the leaf, on white.
//
// The logo files live in assets/brand/:
//   plant-perfect-logo-round.png  the round badge
//   plant-perfect-logo-wide.png   the wide logo
//   plant-perfect-mark.png        the P alone, cut from the wide logo
//
// Run with: node scripts/make-icons.cjs   (needs Playwright's Chromium)
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const MARK = path.join(__dirname, "..", "assets", "brand", "plant-perfect-mark.png");

// `height` is how tall the mark is, as a share of the icon.
const targets = [
  { file: "public/icons/icon-192.png", size: 192, height: 0.72, background: "#ffffff" },
  { file: "public/icons/icon-512.png", size: 512, height: 0.72, background: "#ffffff" },
  // "Maskable" icons get cropped to a circle or rounded square by the phone,
  // so the mark sits smaller, inside the part that is always kept.
  { file: "public/icons/icon-maskable-512.png", size: 512, height: 0.58, background: "#ffffff" },
  // iPhone home screen. iPhones cannot show see-through icons, so it is on white.
  { file: "src/app/apple-icon.png", size: 180, height: 0.68, background: "#ffffff" },
  // Browser tab: the mark alone, see-through around it.
  { file: "src/app/icon.png", size: 96, height: 0.94, background: "transparent" },
];

(async () => {
  const mark = `data:image/png;base64,${fs.readFileSync(MARK).toString("base64")}`;
  const browser = await chromium.launch();
  for (const { file, size, height, background } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0;width:${size}px;height:${size}px;background:${background};display:flex;align-items:center;justify-content:center">
      <img src="${mark}" style="height:${Math.round(size * height)}px;width:auto;display:block"></body>`);
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({ path: file, omitBackground: background === "transparent" });
    await page.close();
    console.log("wrote", file);
  }
  await browser.close();
})();
