const { chromium } = require('playwright');
const ext = require('path').join(__dirname, '..');
const fakeYT = (vid, title, chId, author) => `<!doctype html><html><body>
<div id="above"><div id="owner" class="ytd-watch-metadata">Real Engineering [Subscribe]</div></div><div id="movie_player"><video></video></div><h1 class="ytd-watch-metadata">${title}</h1>
<script>document.getElementById('movie_player').getPlayerResponse = () => ({videoDetails:{videoId:'${vid}',title:${JSON.stringify(title)},channelId:'${chId}',author:'${author}'},microformat:{playerMicroformatRenderer:{ownerProfileUrl:'http://www.youtube.com/@x',publishDate:'2024-03-02'}}});
document.getElementById('movie_player').pauseVideo=()=>{window.paused=true};</script></body></html>`;
(async () => {
  const ctx = await chromium.launchPersistentContext(require('os').tmpdir() + '/altr-profile-' + Date.now(), {
    headless: true, channel: 'chromium', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('chrome-extension://')) return route.continue();
    const json = b => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('youtube.com/watch?v=AAA')) return route.fulfill({ contentType: 'text/html', body: fakeYT('AAA', "Why Planes Don't Fly Faster", 'UCR1', 'Real Engineering') });
    if (u.includes('youtube.com/watch?v=BBB')) return route.fulfill({ contentType: 'text/html', body: fakeYT('BBB', "Why Planes Don't Fly Faster", 'UCR1', 'Real Engineering') });
    if (u.includes('channels.json')) return json([{ name: 'Real Engineering', nebula: 'realengineering', channel: 'UCR1' }]);
    if (u.includes('talent.nebula.tv')) return route.fulfill({ body: '' });
    if (u.includes('/content/realengineering/')) return json({ id: 'c1' });
    if (u.includes('video_channels/c1/video_episodes')) return json({ results: [{ title: "Why Planes Don’t Fly Faster", published_at: '2024-03-01', share_url: 'https://nebula.tv/videos/why-planes' }] });
    if (u.includes('nebula.tv/videos/why-planes')) return route.fulfill({ contentType: 'text/html', body: '<h1>NEBULA PAGE</h1>' });
    if (u.includes('floatplane')) return route.fulfill({ status: 401, body: '{}' });
    return route.fulfill({ status: 404, body: '' });
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];

  // Not subscribed -> button
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=AAA');
  await page.waitForSelector('.altr-btn', { timeout: 15000 });
  console.log('button shown:', await page.textContent('.altr-wrap'));
  await page.screenshot({ path: require('os').tmpdir() + '/button.png' });

  // Subscribe via options page
  const opt = await ctx.newPage();
  opt.on('console', m => console.log('opt console:', m.text())); opt.on('pageerror', e => console.log('opt error:', e.message));
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.check('#nebulaSubscribed');
  await opt.waitForTimeout(3000);
  console.log('fp list:', (await opt.textContent('#fpList')).trim().slice(0, 80));
  await opt.screenshot({ path: require('os').tmpdir() + '/options.png', fullPage: true });
  await opt.close();

  // Subscribed -> countdown then redirect (different video ID to avoid cache)
  await page.goto('https://www.youtube.com/watch?v=BBB');
  await page.waitForSelector('.altr-toast', { timeout: 15000 });
  console.log('toast:', await page.textContent('.altr-toast'), '| paused:', await page.evaluate(() => window.paused));
  await page.screenshot({ path: require('os').tmpdir() + '/toast.png' });
  await page.waitForURL('**/nebula.tv/videos/why-planes', { timeout: 8000 });
  console.log('redirected to:', page.url());

  // Back -> should NOT redirect again (once per tab)
  await page.goBack();
  await page.waitForSelector('.altr-btn', { timeout: 15000 });
  console.log('after back:', await page.textContent('.altr-wrap'), '| url', page.url());
  // Button-only mode while subscribed
  const opt2 = await ctx.newPage();
  await opt2.goto(`chrome-extension://${extId}/options.html`);
  await opt2.check('input[name=mode][value=button]');
  await opt2.waitForTimeout(500); await opt2.close();
  await page.goto('https://www.youtube.com/watch?v=AAA&t=1');
  await page.waitForSelector('.altr-btn', { timeout: 15000 });
  await page.waitForTimeout(3500);
  console.log('button mode, still on:', page.url(), '| inline:', await page.evaluate(() => !!document.querySelector('#above .altr-inline')));
  await ctx.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
