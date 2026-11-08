// Loads the real extension in Chromium against mocked YouTube / Nebula pages.
const { chromium } = require('playwright');
const assert = require('assert');
const os = require('os');
const ext = require('path').join(__dirname, '..');
const shot = name => require('path').join(os.tmpdir(), `detour-${name}.png`);

const fakeVideo = (vid, title, chId, author) => `<!doctype html><html dark><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;margin:0">
<div id="movie_player" style="position:relative;width:800px;height:450px;background:#000"><video></video></div>
<h1 class="ytd-watch-metadata">${title}</h1>
<script>document.getElementById('movie_player').getPlayerResponse = () => ({videoDetails:{videoId:'${vid}',title:${JSON.stringify(title)},channelId:'${chId}',author:'${author}'},microformat:{playerMicroformatRenderer:{ownerProfileUrl:'http://www.youtube.com/@x',publishDate:'2024-03-02'}}});
document.getElementById('movie_player').pauseVideo=()=>{window.paused=true};</script></body></html>`;

const fakeChannel = (dark) => `<!doctype html><html ${dark ? 'dark' : ''}><body style="background:${dark ? '#0f0f0f' : '#fff'};color:${dark ? '#fff' : '#0f0f0f'};font-family:sans-serif;margin:0;padding:24px">
<div id="page-header"><h1>Real Engineering</h1></div>
<div id="tabs-container">Home · Videos · Shorts</div>
<script>window.ytInitialData = {metadata:{channelMetadataRenderer:{title:'Real Engineering',externalId:'UCR1',vanityChannelUrl:'http://www.youtube.com/@RealEngineering'}}};</script>
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
    if (u.includes('youtube.com/watch?v=AAA')) return html(fakeVideo('AAA', "Why Planes Don't Fly Faster", 'UCR1', 'Real Engineering'));
    if (u.includes('youtube.com/watch?v=BBB')) return html(fakeVideo('BBB', "Why Planes Don't Fly Faster", 'UCR1', 'Real Engineering'));
    if (u.includes('youtube.com/@RealEngineering/videos')) return html(fakeChannel(false));
    if (u.includes('youtube.com/@RealEngineering')) return html(fakeChannel(true));
    if (u.includes('channels.json')) return json([{ name: 'Real Engineering', nebula: 'realengineering', channel: 'UCR1' }]);
    if (u.includes('talent.nebula.tv')) return route.fulfill({ body: '' });
    if (u.includes('/content/realengineering/')) return json({ id: 'c1' });
    if (u.includes('video_channels/c1/video_episodes')) return json({ results: [{ title: 'Why Planes Don’t Fly Faster', published_at: '2024-03-01', share_url: 'https://nebula.tv/videos/why-planes' }] });
    if (u.includes('nebula.tv/videos/why-planes')) return html('<h1>NEBULA PAGE</h1>');
    if (u.includes('floatplane')) return route.fulfill({ status: 401, body: '{}' });
    return route.fulfill({ status: 404, body: '' });
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];
  const setOption = async fn => { const o = await ctx.newPage(); await o.goto(`chrome-extension://${extId}/options.html`); await fn(o); await o.waitForTimeout(500); await o.close(); };

  // 1. Not subscribed -> badge on the player
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAA');
  await page.waitForSelector('#movie_player .detour-badge', { timeout: 15000 });
  const badge = await page.textContent('.detour-badge');
  console.log('player badge:', badge);
  assert.ok(badge.includes('Watch on Nebula') && badge.includes('Also available on Nebula'));
  await page.screenshot({ path: shot('video-badge') });

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
  await page.waitForSelector('.detour-badge', { timeout: 15000 });
  assert.ok(page.url().includes('watch?v=BBB'), 'Back should stay on YouTube');
  assert.ok((await page.textContent('.detour-badge')).includes('Included in your subscription'));
  console.log('after back: badge shown, still on', page.url());

  // 4. Button-only mode -> no redirect
  await setOption(o => o.check('input[name=mode][value=button]'));
  await page.goto('https://www.youtube.com/watch?v=AAA&t=1');
  await page.waitForSelector('.detour-badge', { timeout: 15000 });
  await page.waitForTimeout(3500);
  assert.ok(page.url().includes('watch?v=AAA'), 'button mode must not redirect');
  console.log('button mode: no redirect');

  // 5. Channel page, dark mode -> banner before the tabs, dark tint
  await page.goto('https://www.youtube.com/@RealEngineering');
  await page.waitForSelector('.detour-banner', { timeout: 15000 });
  const darkBg = await page.$eval('.detour-banner', e => getComputedStyle(e).backgroundColor);
  const beforeTabs = await page.evaluate(() => document.querySelector('.detour-banner').nextElementSibling?.id);
  console.log('channel banner (dark):', await page.textContent('.detour-banner'), '|', darkBg, '| before:', beforeTabs);
  assert.equal(beforeTabs, 'tabs-container');
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

  console.log('\ne2e passed');
  await ctx.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
