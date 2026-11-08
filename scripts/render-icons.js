// Renders icons/icon.svg to the PNG sizes the extension uses.
// At 16 and 32 px the arrow is drawn thicker and the highlight dropped, so it stays crisp.
// Run: node scripts/render-icons.js   (needs Playwright's Chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'icons');
const base = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const small = base.replace(/stroke-width="13"/g, 'stroke-width="16"').replace(/<rect[^>]*url\(#hl\)[^>]*\/>/, '');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    const svg = (size <= 32 ? small : base).replace('width="128" height="128" viewBox', `width="${size}" height="${size}" viewBox`);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.locator('svg').screenshot({ path: path.join(dir, `icon${size}.png`), omitBackground: true });
    console.log(`icons/icon${size}.png`);
  }
  await browser.close();
})();
