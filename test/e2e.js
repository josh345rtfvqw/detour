// Loads the real extension in Chromium against mocked YouTube / Nebula pages.
const { chromium } = require('playwright');
const assert = require('assert');
const os = require('os');
const ext = require('path').join(__dirname, '..');
const shot = name => require('path').join(os.tmpdir(), `detour-${name}.png`);

// Mimics YouTube's watch page: player, then ytd-watch-metadata > #top-row > #actions > #actions-inner.
// With lateRow, the actions row only appears after 2.5s (as on a slow real load), and the page
// records whether our UI was ever shown floating before it landed in the row.
const fakeVideo = (vid, title, chId, author, lateRow) => `<!doctype html><html dark><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;margin:0">
<div id="movie_player" style="position:relative;width:800px;height:450px;background:#000"><video></video></div>
<ytd-watch-metadata style="display:block;width:800px"><div id="title"><h1 class="ytd-watch-metadata" style="margin:12px 0">${title}</h1></div>
<div id="slot"></div></ytd-watch-metadata>
<script>
const p = document.getElementById('movie_player');
p.getPlayerResponse = () => ({videoDetails:{videoId:'${vid}',title:${JSON.stringify(title)},channelId:'${chId}',author:'${author}'},microformat:{playerMicroformatRenderer:{ownerProfileUrl:'http://www.youtube.com/@x',publishDate:'2024-03-02'}}});
p.pauseVideo = () => { window.paused = true; };
window.sawFloating = false;
new MutationObserver(() => { if (document.querySelector('.detour-floating')) window.sawFloating = true; }).observe(document.documentElement, {subtree:true, childList:true, attributes:true});
const addRow = () => { document.getElementById('slot').outerHTML = '<div id="top-row" style="display:flex;justify-content:space-between;align-items:center"><div id="owner">${author} [Subscribe]</div><div id="actions"><div id="actions-inner" style="display:flex;gap:8px;align-items:center"><button>Like</button><button>Share</button><button>Save</button></div></div></div>'; };
${lateRow ? 'setTimeout(addRow, 2500);' : 'addRow();'}
</script></body></html>`;

// Mimics YouTube's channel header: yt-page-header-view-model > yt-flexible-actions-view-model
// (the Subscribe row), followed by the fixed-height tab bar.
const fakeChannel = (dark) => `<!doctype html><html ${dark ? 'dark' : ''}><head><meta charset="utf-8"></head><body style="background:${dark ? '#0f0f0f' : '#fff'};color:${dark ? '#fff' : '#0f0f0f'};font-family:sans-serif;margin:0;padding:24px">
<div id="page-header"><yt-page-header-view-model style="display:block"><h1>Real Engineering</h1>
<yt-flexible-actions-view-model style="display:block"><button>Subscribe</button></yt-flexible-actions-view-model></yt-page-header-view-model></div>
<div id="tabs-container" style="height:48px;overflow:hidden">Home · Videos · Shorts</div>
<script>window.ytInitialData = {metadata:{channelMetadataRenderer:{title:'Real Engineering',externalId:'UCR1IuLEqb6UEA_zQ81kwXfg',vanityChannelUrl:'http://www.youtube.com/@RealEngineering'}}};</script>
</body></html>`;

(async () => {
  const ctx = await chromium.launchPersistentContext(os.tmpdir() + '/detour-profile-' + Date.now(), {
    headless: true, channel: 'chromium', viewport: { width: 1100, height: 700 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('chrome-extension://')) return route.continue();
    const json = b => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    const html = b => route.fulfill({ contentType: 'text/html', body: b });
    if (u.includes('youtube.com/watch?v=AAA')) return html(fakeVideo('AAA', "Why Planes Don't Fly Faster", 'UCR1IuLEqb6UEA_zQ81kwXfg', 'Real Engineering', true));
    if (u.includes('youtube.com/watch?v=BBB')) return html(fakeVideo('BBB', "Why Planes Don't Fly Faster", 'UCR1IuLEqb6UEA_zQ81kwXfg', 'Real Engineering'));
    if (u.includes('youtube.com/@RealEngineering/videos')) return html(fakeChannel(false));
    if (u.includes('youtube.com/@RealEngineering')) return html(fakeChannel(true));
    if (u.includes('talent.nebula.tv/creators')) return html('<div id="creator-wall"><div class="youtube-creator" data-video="UCR1IuLEqb6UEA_zQ81kwXfg"><img alt="Real Engineering"><h3><a href="https://talent.nebula.tv/realengineering/">Real Engineering</a></h3><a class="link nebula" href="https://nebula.tv/realengineering">Nebula</a></div></div>');
    if (u.includes('/content/realengineering/')) return json({ id: 'c1' });
    if (u.includes('video_channels/c1/video_episodes')) return json({ results: [{ title: 'Why Planes Don’t Fly Faster', published_at: '2024-03-01', share_url: 'https://nebula.tv/videos/why-planes' }] });
    if (u.includes('nebula.tv/videos/why-planes')) return html('<h1>NEBULA PAGE</h1>');
    if (u.includes('github.io/detour/data/known.json')) return json({ version: 3, videos: {},
      channels: { UCR1IuLEqb6UEA_zQ81kwXfg: { name: 'Real Engineering', nebula: 'realengineering' } },
      nebula: { creators: { realengineering: { name: 'Real Engineering', catalog: false } } },
      floatplane: { creators: { lttid: { name: 'LinusTechTips', urlname: 'linustechtips', channels: {}, catalog: false },
        l1t: { name: 'Level1Techs', urlname: 'level1techs', channels: {}, catalog: false } } } });
    if (u.includes('floatplane')) return route.fulfill({ status: 401, body: '{}' });
    return route.fulfill({ status: 404, body: '' });
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const setOption = async fn => { const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`); await fn(o); await o.waitForTimeout(500); await o.close(); };

  // 1. Not subscribed, slow page: chip waits for the Like/Share row, never floats first
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAA');
  await page.waitForSelector('#title .detour-chips.detour-inline .detour-chip', { timeout: 15000 });
  const chip = await page.textContent('.detour-chip');
  const pos = await page.evaluate(() => {
    const c = document.querySelector('.detour-chip').getBoundingClientRect();
    const h = document.querySelector('#title h1').getBoundingClientRect();
    const t = document.querySelector('#title').getBoundingClientRect();
    return { sameLine: c.top < h.bottom && c.bottom > h.top, rightAligned: Math.abs(c.right - t.right) < 2, noOverlap: c.left >= h.right - 1 };
  });
  console.log('chip:', chip.trim(), '|', JSON.stringify(pos), '| ever floating:', await page.evaluate(() => window.sawFloating));
  assert.equal(chip.trim(), 'Also on Nebula');
  assert.ok(pos.sameLine && pos.rightAligned && pos.noOverlap, 'chip should sit at the right end of the title line');
  assert.equal(await page.evaluate(() => window.sawFloating), false, 'chip must not appear floating before the row exists');
  await page.screenshot({ path: shot('video-chip') });

  // 2. Subscribe -> countdown, video paused, then redirect
  await setOption(o => o.check('#nebulaSubscribed'));
  await page.goto('https://www.youtube.com/watch?v=BBB');
  await page.waitForSelector('.detour-toast', { timeout: 15000 });
  assert.ok(await page.evaluate(() => window.paused), 'video should be paused during countdown');
  console.log('toast:', await page.textContent('.detour-toast'));
  await page.screenshot({ path: shot('toast') });
  await page.waitForURL('**/nebula.tv/videos/why-planes', { timeout: 8000 });
  console.log('redirected to:', page.url());

  // 3. Back -> stays on YouTube, shows the subscribed badge instead
  await page.goBack();
  await page.waitForSelector('.detour-chips.detour-inline .detour-chip', { timeout: 15000 });
  assert.ok(page.url().includes('watch?v=BBB'), 'Back should stay on YouTube');
  assert.equal((await page.textContent('.detour-chip')).trim(), 'Watch on Nebula');
  console.log('after back: "Watch on Nebula" chip shown, still on', page.url());

  // 4. Button-only mode -> no redirect
  await setOption(o => o.check('input[name=mode][value=button]'));
  await page.goto('https://www.youtube.com/watch?v=AAA&t=1');
  await page.waitForSelector('.detour-chip', { timeout: 15000 });
  await page.waitForTimeout(3500);
  assert.ok(page.url().includes('watch?v=AAA'), 'button mode must not redirect');
  console.log('button mode: no redirect');

  // 5. Channel page, dark mode -> banner before the tabs, dark tint
  await page.goto('https://www.youtube.com/@RealEngineering');
  await page.waitForSelector('.detour-banner', { timeout: 15000 });
  const darkBg = await page.$eval('.detour-banner', e => getComputedStyle(e).backgroundColor);
  const where = await page.evaluate(() => {
    const b = document.querySelector('.detour-banner');
    return { afterSubscribe: b.previousElementSibling?.tagName.toLowerCase(), inTabs: !!b.closest('#tabs-container') };
  });
  console.log('channel banner (dark):', await page.textContent('.detour-banner'), '|', darkBg, '|', JSON.stringify(where));
  assert.equal(where.afterSubscribe, 'yt-flexible-actions-view-model', 'banner goes right under the Subscribe row');
  assert.equal(where.inTabs, false, 'banner must not be inside the tab bar');
  assert.ok(await page.$eval('.detour-banner a', a => a.href === 'https://nebula.tv/realengineering'));
  await page.screenshot({ path: shot('channel-dark') });

  // 6. Light mode -> light tint
  await page.goto('https://www.youtube.com/@RealEngineering/videos');
  await page.waitForSelector('.detour-banner', { timeout: 15000 });
  const lightBg = await page.$eval('.detour-banner', e => getComputedStyle(e).backgroundColor);
  console.log('channel banner (light):', lightBg);
  assert.notEqual(darkBg, lightBg);
  await page.screenshot({ path: shot('channel-light') });

  // 7. Dismiss -> stays hidden for that channel
  await page.click('.detour-banner .detour-close');
  await page.waitForTimeout(500);
  await page.goto('https://www.youtube.com/@RealEngineering');
  await page.waitForTimeout(3000);
  assert.equal(await page.$('.detour-banner'), null, 'dismissed banner should stay hidden');
  console.log('dismissed banner stays hidden');

  // 8. A header rule gives the extension's own requests to Nebula / Floatplane a User-Agent of
  //    "<browser UA> Detour/<version> (+repo)". (Playwright's interception sees requests before
  //    the rule applies, so check the installed rule; the on-the-wire header was verified with a
  //    local HTTPS server standing in for floatplane.com.)
  const version = require('../manifest.json').version;
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  const ua = rules.find(r => r.action.requestHeaders?.[0]?.header === 'User-Agent');
  assert.ok(ua, 'User-Agent rule installed');
  assert.ok(ua.action.requestHeaders[0].value.endsWith(`Detour/${version} (+https://github.com/josh345rtfvqw/detour)`));
  assert.deepEqual(ua.condition.tabIds, [-1], 'only the extension\'s own requests, not the user\'s tabs');
  assert.ok(['floatplane.com', 'nebula.app', 'nebula.tv'].every(d => ua.condition.requestDomains.includes(d)));
  console.log('User-Agent rule:', ua.action.requestHeaders[0].value);
  // Settings popup: Floatplane creators listed from the master list, with no Floatplane login.
  const opts = await ctx.newPage();
  const pageErrors = [];
  opts.on('pageerror', e => pageErrors.push(e.message));
  await opts.goto(`chrome-extension://${extId}/options.html`);
  await opts.waitForSelector('#fpList .creator', { timeout: 10000 });
  const names = await opts.$$eval('#fpList .creator .name', els => els.map(e => e.textContent));
  assert.deepEqual(names.sort(), ['Level1Techs', 'LinusTechTips']);
  assert.deepEqual(pageErrors, [], 'no errors on the settings page');
  console.log('settings popup lists Floatplane creators:', names.join(', '));
  console.log('\ne2e passed');
  await ctx.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
