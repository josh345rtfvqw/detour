// Renders store/assets/social-preview-1280x640.png, the GitHub repository social card.
// Everything important stays inside a 40px margin, per GitHub's template.
// Run: node store/assets/make-social-card.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const icon = fs.readFileSync(path.join(root, 'icons', 'icon.svg'), 'utf8');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 640px; overflow: hidden;
    background: radial-gradient(900px 500px at 15% 0%, rgba(122,92,255,.28), transparent 60%),
                radial-gradient(800px 500px at 100% 100%, rgba(10,162,230,.22), transparent 60%), #0d0d14;
    color: #f1f1f6; font-family: Inter, system-ui, "Segoe UI", Roboto, sans-serif;
    display: flex; align-items: center; justify-content: center; }
  .card { width: 1200px; height: 560px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; gap: 22px; }
  .brand { display: flex; align-items: center; gap: 28px; }
  .brand svg { width: 132px; height: 132px; }
  h1 { font-size: 112px; font-weight: 800; letter-spacing: -3px; line-height: 1; }
  p { font-size: 36px; line-height: 1.35; color: #c4c6da; max-width: 980px; }
  .pills { display: flex; gap: 16px; margin-top: 10px; }
  .pill { font-size: 26px; font-weight: 600; padding: 10px 24px; border-radius: 999px; }
  .nebula { background: rgba(122,92,255,.18); color: #b9a8ff; border: 1px solid rgba(122,92,255,.45); }
  .fp { background: rgba(10,162,230,.16); color: #7fd2f7; border: 1px solid rgba(10,162,230,.45); }
</style></head><body><div class="card">
  <div class="brand">${icon}<h1>Detour</h1></div>
  <p>See when a YouTube video is also on Nebula or Floatplane, and open it there.</p>
  <div class="pills"><span class="pill nebula">Nebula</span><span class="pill fp">Floatplane</span></div>
</div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: path.join(__dirname, 'social-preview-1280x640.png') });
  await browser.close();
})();
