// Generates the promo video for the Chrome Web Store listing (store/assets/promo-video.mp4,
// 1920x1080, 30 fps, silent). Upload it to YouTube and paste the link into the listing.
//
// 1. The real extension runs in Playwright's Chromium against the generic mock video site
//    (store/assets/mock-site.js: no YouTube branding, made-up creators), and each state is
//    captured: the button appearing, the redirect countdown, the channel banner, Floatplane,
//    and the settings popup.
// 2. Those captures are animated by an HTML timeline that is rendered one frame at a time
//    (render(t) per frame, so nothing depends on how fast the machine is), then encoded with ffmpeg.
//
// Run from the repo root:  PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node store/assets/make-promo-video.js
// (add STILLS=4,9.5 to render only those moments as PNGs for checking)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { installMockSite } = require('./mock-site.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'promo-video.mp4');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'detour-promo-'));
const W = 1920, H = 1080, FPS = 30;
const VW = 1180, VH = 640; // captured page size (CSS px), captured at 2x
const WW = 1416, WH = 768;  // the window the page is shown in, in the video (1.2x)
const ICON_SVG = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(ROOT, 'icons', 'icon.svg')).toString('base64');

// ------------------------------------------------------------------ 1. capture

async function capture() {
  const ctx = await chromium.launchPersistentContext(path.join(TMP, 'profile'), {
    headless: true, channel: 'chromium', viewport: { width: VW, height: VH }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  await installMockSite(ctx);
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const settings = s => sw.evaluate(v => chrome.storage.sync.set(v), s);
  const img = {}, box = {};
  const shoot = async (page, name, opts = {}) => {
    const buf = await page.screenshot(opts);
    img[name] = 'data:image/png;base64,' + buf.toString('base64');
  };
  const rect = (page, sel) => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

  const page = await ctx.newPage();
  // Video page after the button appears, then the same page with the button taken out ("before").
  await settings({ nebulaSubscribed: true, autoRedirect: false, floatplaneCreators: ['exlabs'] });
  await page.goto('https://www.youtube.com/watch?v=NEB1');
  await page.waitForSelector('.detour-chip');
  await page.waitForTimeout(500);
  await shoot(page, 'videoAfter');
  box.chip = await rect(page, '.detour-chip');
  await page.evaluate(() => document.querySelector('.detour-chips').style.visibility = 'hidden');
  await shoot(page, 'videoBefore');

  // Redirect countdown, one capture per second.
  await settings({ autoRedirect: true });
  await page.goto('https://www.youtube.com/watch?v=NEB2');
  await page.waitForSelector('.detour-toast');
  box.toast = await rect(page, '.detour-toast');
  await shoot(page, 'count3');
  await page.waitForTimeout(1000); await shoot(page, 'count2');
  await page.waitForTimeout(1000); await shoot(page, 'count1');

  // Channel banner.
  await settings({ autoRedirect: false });
  await page.goto('https://www.youtube.com/@ExampleEngineering');
  await page.waitForSelector('.detour-banner');
  await page.waitForTimeout(500);
  await shoot(page, 'channel');
  box.banner = await rect(page, '.detour-banner');

  // Floatplane, light theme.
  await page.goto('https://www.youtube.com/watch?v=FP1');
  await page.waitForSelector('.detour-chip');
  await page.waitForTimeout(500);
  await shoot(page, 'floatplane');
  box.fpChip = await rect(page, '.detour-chip');

  // Settings popup.
  const opt = await ctx.newPage();
  await opt.setViewportSize({ width: 400, height: 640 });
  await opt.emulateMedia({ colorScheme: 'dark' });
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.waitForSelector('.creator');
  await opt.waitForTimeout(300);
  await shoot(opt, 'settings', { clip: { x: 0, y: 0, width: 400, height: 640 } });
  await ctx.close();
  return { img, box };
}

// ------------------------------------------------------------------ 2. timeline

// Scenes run back to back; each gets its local time and progress. Times in seconds.
function timelinePage({ img, box }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#0d0d14;font-family:Inter,sans-serif;color:#fff}
.bg{position:absolute;inset:0;background:radial-gradient(1600px 900px at 12% -10%,#3b2f8f 0%,transparent 60%),radial-gradient(1300px 800px at 110% 115%,#06506f 0%,transparent 55%),#0d0d14}
.scene{position:absolute;inset:0;opacity:0}
.win{position:absolute;left:50%;top:252px;width:${WW}px;height:${WH}px;margin-left:${-WW / 2}px;border-radius:16px;overflow:hidden;box-shadow:0 40px 110px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08)}
.stage{position:absolute;left:0;top:0;width:${VW}px;height:${VH}px;transform-origin:0 0}
.screen{position:absolute;inset:0}
.screen img{position:absolute;inset:0;width:100%;height:100%}
.cap{position:absolute;left:0;right:0;top:64px;text-align:center}
.cap h1{margin:0;font-size:60px;font-weight:800;letter-spacing:-.025em}
.cap p{margin:14px 0 0;font-size:28px;color:#c9cbe0;font-weight:500}
.ring{position:absolute;border:4px solid #ffd54a;border-radius:22px;box-shadow:0 0 0 9999px rgba(8,8,14,.0)}
.cursor{position:absolute;width:30px;height:30px;left:0;top:0}
.brand{position:absolute;left:44px;bottom:36px;display:flex;align-items:center;gap:12px;font-weight:700;font-size:24px;opacity:.85}
.brand img{width:36px;height:36px}
.title{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px}
.title img{width:220px;height:220px;filter:drop-shadow(0 18px 40px rgba(0,0,0,.45))}
.title h1{margin:0;font-size:120px;font-weight:800;letter-spacing:-.035em;line-height:1}
.title p{margin:0;font-size:40px;color:#d6d8f0;font-weight:500;text-align:center;line-height:1.35}
.title small{font-size:20px;color:#9a9cb8;font-weight:500}
.popup{position:absolute;left:50%;top:252px;width:400px;height:640px;margin-left:-200px;transform-origin:50% 0;border-radius:16px;overflow:hidden;box-shadow:0 40px 110px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.1)}
.popup img{width:100%;height:100%}
</style></head><body><div class="bg"></div>

<div class="scene title" id="s-intro"><img src="${ICON_SVG}"><h1>Detour</h1><p>Watch YouTube videos on<br>Nebula and Floatplane</p></div>

<div class="scene" id="s-video">
  <div class="cap"><h1 id="v-h">Is this video on Nebula?</h1><p id="v-p">Detour checks while the page loads.</p></div>
  <div class="win"><div class="stage" id="v-stage"><div class="screen"><img src="${img.videoBefore}"><img id="v-after" src="${img.videoAfter}" style="opacity:0"></div>
    <div class="ring" id="v-ring"></div>
    <svg class="cursor" id="v-cur" viewBox="0 0 24 24"><path d="M4 2l15 10-7 1.5 4 7.5-3 1.5-4-7.5L4 20z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/></svg>
  </div></div>
</div>

<div class="scene" id="s-redirect">
  <div class="cap"><h1>Subscribe there? Go automatically.</h1><p>A 3-second countdown, with a “Stay on YouTube” option.</p></div>
  <div class="win"><div class="stage" id="r-stage"><div class="screen"><img id="r3" src="${img.count3}"><img id="r2" src="${img.count2}" style="opacity:0"><img id="r1" src="${img.count1}" style="opacity:0"></div></div></div>
</div>

<div class="scene" id="s-channel">
  <div class="cap"><h1>Find creators’ channels too</h1><p>A banner on the channel page links to them on Nebula or Floatplane.</p></div>
  <div class="win"><div class="stage" id="c-stage"><div class="screen"><img src="${img.channel}"></div></div></div>
</div>

<div class="scene" id="s-fp">
  <div class="cap"><h1>Floatplane too</h1><p>Light and dark themes, both platforms.</p></div>
  <div class="win"><div class="stage" id="f-stage"><div class="screen"><img src="${img.floatplane}"></div></div></div>
</div>

<div class="scene" id="s-settings">
  <div class="cap"><h1>You choose how it works</h1><p>Tick your subscriptions. Pick redirects or just a button.</p></div>
  <div class="popup" id="p-pop"><img src="${img.settings}"></div>
</div>

<div class="scene title" id="s-end"><img src="${ICON_SVG}" style="width:170px;height:170px"><h1 style="font-size:100px">Detour</h1><p>Free on the Chrome Web Store</p>
  <small style="margin-top:30px">Not affiliated with YouTube, Google, Nebula or Floatplane.</small></div>

<div class="brand" id="brand"><img src="${ICON_SVG}">Detour</div>

<script>
const BOX = ${JSON.stringify(box)};
const VW = ${VW}, VH = ${VH}, WW = ${WW}, WH = ${WH}, B = WW / VW;
const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = t => (t = clamp(t), t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const ramp = (t, a, b) => ease((t - a) / (b - a));   // 0 before a, 1 after b, eased between
const lerp = (a, b, k) => a + (b - a) * k;
// A camera inside the window: zoom s, aimed at page point (fx, fy), never showing past the page edges.
function zoom(el, s, fx, fy) {
  const k = B * s;
  const x = clamp(WW / 2 - k * fx, WW - k * VW, 0), y = clamp(WH / 2 - k * fy, WH - k * VH, 0);
  el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';
}
const center = b => [b.x + b.w / 2, b.y + b.h / 2];

// [id, duration]; scenes cross-fade over FADE seconds.
const SCENES = [['s-intro', 3.2], ['s-video', 7.5], ['s-redirect', 5.5], ['s-channel', 5], ['s-fp', 4.5], ['s-settings', 4.5], ['s-end', 4]];
const FADE = .45;
window.TOTAL = SCENES.reduce((a, [, d]) => a + d, 0);

const draw = {
  's-intro'(t) {},
  's-video'(t) {
    const [cx, cy] = center(BOX.chip);
    $('v-after').style.opacity = ramp(t, 1.6, 2.0);
    const z = lerp(1, 1.3, ramp(t, 2.2, 3.6));
    zoom($('v-stage'), z, lerp(VW / 2, cx, ramp(t, 2.2, 3.6)), lerp(VH / 2, cy, ramp(t, 2.2, 3.6)));
    const ring = $('v-ring');
    ring.style.left = (BOX.chip.x - 8) + 'px'; ring.style.top = (BOX.chip.y - 8) + 'px';
    ring.style.width = (BOX.chip.w + 16 - 8) + 'px'; ring.style.height = (BOX.chip.h + 16 - 8) + 'px';
    ring.style.opacity = ramp(t, 2.1, 2.5) * (1 - ramp(t, 6.4, 6.9));
    const cur = $('v-cur');
    const k = ramp(t, 3.6, 5.0);
    cur.style.transform = 'translate(' + lerp(VW * .78, cx, k) + 'px,' + lerp(VH * .9, cy + 4, k) + 'px) scale(' + (t > 5.2 && t < 5.45 ? .82 : 1) + ')';
    cur.style.opacity = ramp(t, 3.4, 3.7) * (1 - ramp(t, 6.6, 7));
    const after = t > 1.8;
    $('v-h').textContent = after ? 'It is. Watch it there.' : 'Is this video on Nebula?';
    $('v-p').textContent = after ? 'A “Watch on Nebula” button appears next to the title.' : 'Detour checks while the page loads.';
  },
  's-redirect'(t) {
    $('r2').style.opacity = t > 2.0 ? 1 : 0;
    $('r1').style.opacity = t > 3.0 ? 1 : 0;
    const [cx, cy] = center(BOX.toast);
    const k = ramp(t, .4, 1.8);
    zoom($('r-stage'), lerp(1, 1.18, k), lerp(VW / 2, cx, k), lerp(VH / 2, cy, k));
  },
  's-channel'(t) {
    const [cx, cy] = center(BOX.banner);
    const k = ramp(t, .5, 2.4);
    zoom($('c-stage'), lerp(1, 1.2, k), lerp(VW / 2, cx, k), lerp(VH / 2, cy, k));
  },
  's-fp'(t) {
    const [cx, cy] = center(BOX.fpChip);
    const k = ramp(t, .5, 2.4);
    zoom($('f-stage'), lerp(1, 1.22, k), lerp(VW / 2, cx, k), lerp(VH / 2, cy, k));
  },
  's-settings'(t) {
    const k = ramp(t, 0, .9);
    $('p-pop').style.transform = 'translateY(' + lerp(60, 0, k) + 'px) scale(' + lerp(1.12, 1.18, k) + ')';
  },
  's-end'(t) {},
};

window.render = function (t) {
  let start = 0;
  for (const [id, d] of SCENES) {
    const local = t - start;
    const el = $(id);
    const fadeIn = id === 's-intro' ? ramp(local, 0, .6) : ramp(local, 0, FADE);
    const last = id === SCENES[SCENES.length - 1][0];
    const fadeOut = last ? 1 - ramp(local, d - .6, d) : 1 - ramp(local, d, d + FADE);
    const o = local < 0 || local > d + FADE ? 0 : Math.min(fadeIn, fadeOut);
    el.style.opacity = o;
    if (o > 0) draw[id](local);
    start += d;
  }
  // The corner brand only during the feature scenes.
  const showBrand = t > SCENES[0][1] && t < window.TOTAL - SCENES[SCENES.length - 1][1];
  $('brand').style.opacity = showBrand ? 1 : 0;
};
render(0);
</script></body></html>`;
}

// ------------------------------------------------------------------ 3. render + encode

(async () => {
  console.log('capturing the extension…');
  const shots = await capture();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(timelinePage(shots), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // STILLS=1.5,8,13 renders just those moments to store/assets/promo-still-<t>.png, for checking.
  if (process.env.STILLS) {
    for (const t of process.env.STILLS.split(',').map(Number)) {
      await page.evaluate(x => window.render(x), t);
      await page.screenshot({ path: path.join(__dirname, `promo-still-${t}.png`) });
    }
    await browser.close();
    return;
  }
  const total = await page.evaluate(() => window.TOTAL);
  const frames = Math.round(total * FPS);
  const dir = path.join(TMP, 'frames');
  fs.mkdirSync(dir);
  console.log(`rendering ${frames} frames (${total}s)…`);
  for (let f = 0; f < frames; f++) {
    await page.evaluate(t => window.render(t), f / FPS);
    await page.screenshot({ path: path.join(dir, `${String(f).padStart(5, '0')}.png`) });
  }
  await browser.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT]);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(path.relative(ROOT, OUT));
})().catch(e => { console.error(e); process.exit(1); });
