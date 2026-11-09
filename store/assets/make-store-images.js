// Generates the Chrome Web Store screenshots (1280x800) and promo tiles from the real extension.
// The extension runs in Playwright's Chromium against generic mock video pages (no YouTube
// branding) with mocked Nebula / Floatplane responses; its real UI is captured and placed in a
// branded frame with a caption.
//
// Run from the repo root:  PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node store/assets/make-store-images.js
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = __dirname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'detour-store-'));
const ICON = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'icons', 'icon128.png')).toString('base64');
const ICON_SVG = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(ROOT, 'icons', 'icon.svg')).toString('base64'); // crisp at any size

const { installMockSite } = require('./mock-site.js');

// ------------------------------------------------------------------ frame + caption

function frame({ headline, sub, shot, shotW, shotH, popup }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:Inter,sans-serif;color:#fff;
  background:radial-gradient(1200px 600px at 15% -10%,#3b2f8f 0%,transparent 60%),radial-gradient(900px 500px at 110% 110%,#06506f 0%,transparent 55%),#0d0d14}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding-top:56px;gap:36px}
h1{margin:0;font-size:46px;font-weight:800;letter-spacing:-.025em;text-align:center}
p{margin:-22px 0 0;font-size:20px;color:#c9cbe0;text-align:center}
.shot{border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08)}
.brand{position:absolute;left:32px;top:26px;display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;opacity:.9}
.brand img{width:30px;height:30px}
</style></head><body><div class="wrap">
<h1>${headline}</h1><p>${sub}</p>
<div class="shot" style="width:${shotW}px;height:${shotH}px${popup ? ';border-radius:14px' : ''}"><img src="${shot}" style="width:${shotW}px;height:${shotH}px;display:block"></div>
</div><div class="brand"><img src="${ICON}">Detour</div></body></html>`;
}

// ------------------------------------------------------------------ run

(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(TMP, 'profile'), {
    headless: true, channel: 'chromium', viewport: { width: 1180, height: 640 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  await installMockSite(ctx);
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const settings = s => sw.evaluate(v => chrome.storage.sync.set(v), s);
  const shots = {};
  // Each capture is also saved uncaptioned as store/assets/ui-<name>.png, for the website.
  const shoot = async (page, name, clip) => {
    const f = path.join(OUT, `ui-${name}.png`);
    await page.screenshot({ path: f, clip });
    shots[name] = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  };

  // 1. Video page, button mode, subscribed to Nebula
  await settings({ nebulaSubscribed: true, autoRedirect: false, floatplaneCreators: ['exlabs'] });
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=NEB1');
  await page.waitForSelector('.detour-chip');
  await page.waitForTimeout(400);
  await shoot(page, 'video');

  // 2. Auto-redirect countdown
  await settings({ autoRedirect: true });
  await page.goto('https://www.youtube.com/watch?v=NEB2');
  await page.waitForSelector('.detour-toast');
  await shoot(page, 'redirect');

  // 3. Channel page banner
  await settings({ autoRedirect: false });
  await page.goto('https://www.youtube.com/@ExampleEngineering');
  await page.waitForSelector('.detour-banner');
  await page.waitForTimeout(400);
  await shoot(page, 'channel');

  // 4. Floatplane, light theme
  await page.goto('https://www.youtube.com/watch?v=FP1');
  await page.waitForSelector('.detour-chip');
  await page.waitForTimeout(400);
  await shoot(page, 'floatplane');

  // 5. Settings popup (real options page, popup width, dark)
  const opt = await ctx.newPage();
  await opt.setViewportSize({ width: 400, height: 640 });
  await opt.emulateMedia({ colorScheme: 'dark' });
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.waitForSelector('.creator');
  await opt.waitForTimeout(300);
  await shoot(opt, 'settings', { x: 0, y: 0, width: 400, height: 640 });
  await ctx.close();

  // Compose 1280x800 store screenshots
  const browser = await chromium.launch();
  const out = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const full = { shotW: 1062, shotH: 576 }; // 1180x640 page scaled to fit under the caption
  const items = [
    ['1-video', { headline: 'Watch it where you already subscribe', sub: 'A “Watch on Nebula” button appears right next to the video title.', shot: shots.video, ...full }],
    ['2-redirect', { headline: 'Or go there automatically', sub: 'Subscribers can be redirected, with a countdown and a “Stay on YouTube” option.', shot: shots.redirect, ...full }],
    ['3-channel', { headline: 'Find creators’ channels too', sub: 'A banner on the channel page links to the creator on Nebula or Floatplane.', shot: shots.channel, ...full }],
    ['4-floatplane', { headline: 'Nebula and Floatplane', sub: 'Works with both, in YouTube’s light and dark themes.', shot: shots.floatplane, ...full }],
    ['5-settings', { headline: 'You decide how it works', sub: 'Tick your subscriptions, then choose redirects or just a button.', shot: shots.settings, shotW: 340, shotH: 544, popup: true }],
  ];
  for (const [name, opts] of items) {
    await out.setContent(frame(opts));
    await out.waitForTimeout(200);
    await out.screenshot({ path: path.join(OUT, `screenshot-${name}.png`) });
    console.log(`store/assets/screenshot-${name}.png`);
  }

  // Promo tiles
  const tile = (w, h, big) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:Inter,sans-serif;color:#fff;display:flex;align-items:center;justify-content:${big ? 'center' : 'flex-start'};gap:${big ? 56 : 22}px;padding:0 ${big ? 96 : 36}px;box-sizing:border-box;
  background:radial-gradient(${w}px ${h}px at 0% 0%,#4a35b8 0%,transparent 65%),radial-gradient(${w}px ${h}px at 100% 100%,#0880b8 0%,transparent 60%),#12121c}
img{width:${big ? 200 : 96}px;height:${big ? 200 : 96}px;filter:drop-shadow(0 10px 24px rgba(0,0,0,.4))}
h1{margin:0;font-size:${big ? 96 : 44}px;font-weight:800;letter-spacing:-.03em;line-height:1}
p{margin:${big ? 18 : 10}px 0 0;font-size:${big ? 34 : 17}px;color:#d6d8f0;line-height:1.3;font-weight:500}
</style></head><body><img src="${ICON_SVG}"><div><h1>Detour</h1><p>YouTube videos on<br>Nebula &amp; Floatplane</p></div></body></html>`;
  for (const [name, w, h, big] of [['promo-small-440x280', 440, 280, false], ['promo-marquee-1400x560', 1400, 560, true]]) {
    await out.setViewportSize({ width: w, height: h });
    await out.setContent(tile(w, h, big));
    await out.waitForTimeout(200);
    await out.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`store/assets/${name}.png`);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
