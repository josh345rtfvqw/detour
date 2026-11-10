// Runs background.js against mocked chrome.* and fetch, to check matching + redirect decisions.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');

function makeEnv(sync, routes) {
  const store = { sync: { ...sync }, local: {} };
  const changeListeners = [];
  const area = (s, name) => ({
    get: async keys => {
      if (keys == null) return { ...s };
      const out = {}; const def = typeof keys === 'string' ? { [keys]: undefined } : keys;
      for (const k of Object.keys(def)) { const v = k in s ? s[k] : def[k]; if (v !== undefined) out[k] = v; }
      return out;
    },
    set: async o => { Object.assign(s, o); changeListeners.forEach(f => f({}, name)); },
    remove: async keys => { [].concat(keys).forEach(k => delete s[k]); },
    clear: async () => { for (const k in s) delete s[k]; },
  });
  const tabsOpened = [];
  const dnr = [];
  let listener;
  const calls = [];
  const ctx = {
    console: { log() {}, warn() {} }, URL, URLSearchParams, Date, Promise, Map, Set, encodeURIComponent,
    chrome: {
      storage: { sync: area(store.sync, 'sync'), local: area(store.local, 'local'), onChanged: { addListener: f => changeListeners.push(f) } },
      runtime: { onMessage: { addListener: f => (listener = f) }, getManifest: () => ({ version: '9.9.9' }) },
      declarativeNetRequest: { updateSessionRules: async o => { dnr.push(o); } },
      tabs: { create: async o => { tabsOpened.push(o.url); } },
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      for (const [re, body] of routes) if (re.test(url)) {
        if (body instanceof Error) return { ok: false, status: 500 };
        return { ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'match.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), ctx);
  const send = msg => new Promise(r => listener(msg, {}, r));
  return { send, calls, store, tabsOpened, routes, dnr, chrome: ctx.chrome };
}

// Mock of Nebula's creator wall (talent.nebula.tv/creators): one card with a Nebula link,
// one with only the card title's link and an HTML entity in the name.
const CREATOR_WALL = `<div id="creator-wall">
<div class="youtube-creator" data-video="UCR1IuLEqb6UEA_zQ81kwXfg"><img alt="Real Engineering" src="x.jpg"><h3><a href="https://talent.nebula.tv/realengineering/">Real Engineering</a></h3><a class="link nebula" href="https://nebula.tv/realengineering">Nebula</a></div>
<div class="youtube-creator" data-video="UCxxxxxxxxxxxxxxxxxxxxxx"><img alt="Tom &amp; Friends" src="y.jpg"><h3><a href="https://talent.nebula.tv/tomandfriends/">Tom &amp; Friends</a></h3></div>
</div>`;

const nebulaRoutes = [
  [/talent\.nebula\.tv\/creators/, CREATOR_WALL],
  [/content\/realengineering\/$/, { id: 'chan-1' }],
  [/video_channels\/chan-1\/video_episodes/, { results: [
    { title: 'Why Planes Don’t Fly Faster', published_at: '2024-03-01T00:00:00Z', share_url: 'https://nebula.tv/videos/realengineering-why-planes' },
    { title: 'The Engineering of the SR-71', published_at: '2023-01-01T00:00:00Z', share_url: 'https://nebula.tv/videos/realengineering-sr71' },
  ] }],
];
const fpRoutes = [
  [/creator\/list/, [{ id: 'ltt', title: 'Linus Tech Tips', urlname: 'linustechtips', socialLinks: { youtube: 'https://www.youtube.com/user/LinusTechTips' },
    channels: [{ id: 'ch-tl', title: 'TechLinked', urlname: 'techlinked', socialLinks: { youtube: 'https://www.youtube.com/@techlinked' } }] }]],
  [/content\/creator\?.*channel=ch-tl/, [{ id: 'post1', title: 'Nvidia did WHAT? - TechLinked', releaseDate: '2024-05-02T00:00:00Z' },
    { id: 'post2', title: 'Apple is in trouble', releaseDate: '2024-04-01T00:00:00Z' }]],
];

(async () => {
  // 1. Nebula match, subscribed -> best result is a confident, subscribed video
  let env = makeEnv({ nebulaSubscribed: true }, [...nebulaRoutes, [/floatplane/, new Error()]]);
  let r = await env.send({ type: 'lookup', info: { videoId: 'a', title: 'Why Planes Don\'t Fly Faster', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering', publishDate: '2024-03-03' } });
  assert.equal(r.results[0].platform, 'nebula');
  assert.equal(r.results[0].kind, 'video');
  assert.equal(r.results[0].url, 'https://nebula.tv/videos/realengineering-why-planes');
  assert.ok(r.results[0].subscribed && r.results[0].confidence >= 0.75, JSON.stringify(r.results[0]));
  console.log('ok  nebula video match, subscribed', r.results[0].confidence.toFixed(2));

  // 2. Unknown video from a Nebula channel -> channel link, not a redirect
  r = await env.send({ type: 'lookup', info: { videoId: 'b', title: 'Totally unrelated vlog about cats', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' } });
  assert.equal(r.results[0].kind, 'channel');
  assert.equal(r.results[0].url, 'https://nebula.tv/realengineering');
  console.log('ok  unmatched video falls back to channel link');

  // 3. Floatplane sub-channel matched by @handle, user subscribed to that creator
  env = makeEnv({ floatplaneCreators: ['ltt'] }, [[/nebula/, new Error()], ...fpRoutes]);
  r = await env.send({ type: 'lookup', info: { videoId: 'c', title: 'Nvidia did WHAT?', channelId: 'UCeeFfhMcJa1kjtfZAGskOCA', author: 'TechLinked', profileUrl: 'http://www.youtube.com/@TechLinked', publishDate: '2024-05-03' } });
  assert.equal(r.results[0].platform, 'floatplane');
  assert.equal(r.results[0].url, 'https://www.floatplane.com/post/post1');
  assert.ok(r.results[0].subscribed);
  const fpCall = env.calls.find(c => c.url.includes('floatplane'));
  assert.equal(fpCall.init.credentials, 'include');
  console.log('ok  floatplane channel match via handle, uses login cookies', r.results[0].confidence.toFixed(2));

  // 4. Same but not subscribed -> result present, subscribed=false (button only)
  env = makeEnv({ floatplaneCreators: [] }, [[/nebula/, new Error()], ...fpRoutes]);
  r = await env.send({ type: 'lookup', info: { videoId: 'c', title: 'Nvidia did WHAT?', author: 'TechLinked', profileUrl: 'http://www.youtube.com/@TechLinked' } });
  assert.equal(r.results[0].subscribed, false);
  console.log('ok  not subscribed -> no auto-redirect flag');

  // 5. Nebula API down -> RSS fallback
  const rss = `<rss><channel><item><title><![CDATA[Why Planes Don&apos;t Fly Faster]]></title><link>https://nebula.tv/videos/realengineering-why-planes</link><pubDate>Fri, 01 Mar 2024 00:00:00 GMT</pubDate></item></channel></rss>`;
  env = makeEnv({ nebulaSubscribed: true }, [nebulaRoutes[0], [/content\.api\.nebula/, new Error()], [/rss\.nebula\.app\/video\/channels\/realengineering\.rss/, rss], [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'd', title: 'Why Planes Don\'t Fly Faster', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' } });
  assert.equal(r.results[0].kind, 'video');
  assert.equal(r.results[0].url, 'https://nebula.tv/videos/realengineering-why-planes');
  console.log('ok  RSS fallback when Nebula API fails');

  // 6. Channel on neither platform -> no results
  r = await env.send({ type: 'lookup', info: { videoId: 'e', title: 'x', channelId: 'UCnope', author: 'Someone Else' } });
  assert.equal(r.results.length, 0);
  console.log('ok  unrelated channel -> nothing shown');
  // 7. Floatplane creator list unavailable (not logged in) -> the master list's creators still
  //    match TechLinked (via the master channels table) and link to the right sub-channel.
  const MASTER_RE = /josh345rtfvqw\.github\.io\/detour\/data\/known\.json/;
  const fpMaster = { version: 3, videos: {}, nebula: { creators: {} },
    channels: { UCeeFfhMcJa1kjtfZAGskOCA: { name: 'TechLinked', floatplane: 'lttid/techlinkedid' } },
    floatplane: { creators: {
      lttid: { name: 'LinusTechTips', urlname: 'linustechtips', channels: { techlinkedid: { name: 'TechLinked', urlname: 'techlinked' } }, catalog: false },
      l1t: { name: 'Level1Techs', urlname: 'level1techs', channels: {}, catalog: false } } } };
  env = makeEnv({ floatplaneCreators: ['lttid'] }, [[MASTER_RE, fpMaster], [/nebula/, new Error()], [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookupChannel', info: { channelId: 'UCeeFfhMcJa1kjtfZAGskOCA', author: 'TechLinked', profileUrl: 'http://www.youtube.com/@TechLinked' } });
  assert.equal(r.results[0].platform, 'floatplane');
  assert.equal(r.results[0].url, 'https://www.floatplane.com/channel/linustechtips/home/techlinked');
  assert.ok(r.results[0].subscribed);
  const fpList = await env.send({ type: 'fpCreators' });
  assert.deepEqual(fpList.creators.map(c => c.title).sort(), ['Level1Techs', 'LinusTechTips']);
  console.log('ok  master list Floatplane creators used when the live list fails');

  // 8. Live list loads -> it wins, and master creators missing from it are still added
  env = makeEnv({}, [[MASTER_RE, fpMaster], [/nebula/, new Error()], [/creator\/list/, [{ id: 'new1', title: 'Someone New', urlname: 'someonenew', socialLinks: {}, channels: [] }]]]);
  const merged = (await env.send({ type: 'fpCreators' })).creators;
  assert.ok(merged.some(c => c.id === 'new1' && !c.builtin) && merged.some(c => c.urlname === 'linustechtips'));
  console.log('ok  live list merged with master list creators');

  // 9. A subscription saved by name by an older version still counts.
  env = makeEnv({ floatplaneCreators: ['name:level1techs'] }, [[MASTER_RE, fpMaster], [/nebula/, new Error()], [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookupChannel', info: { author: 'Level1Techs' } });
  assert.equal(r.results[0].url, 'https://www.floatplane.com/channel/level1techs/home');
  assert.ok(r.results[0].subscribed);
  console.log('ok  older by-name subscription still counts');

  // 10. No master list and no live list -> no Floatplane creators, nothing breaks.
  env = makeEnv({}, [[/nebula/, new Error()], [/floatplane/, new Error()]]);
  assert.deepEqual((await env.send({ type: 'fpCreators' })).creators, []);
  r = await env.send({ type: 'lookupChannel', info: { author: 'Level1Techs' } });
  assert.equal(r.results.length, 0);
  console.log('ok  no creator lists available -> no Floatplane results');
  // 11. Creator wall parsing: entity in the name decoded, slug from the card title when there's
  //     no Nebula link; matched by channel name too.
  env = makeEnv({ nebulaSubscribed: true }, [nebulaRoutes[0], [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookupChannel', info: { channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx', author: 'Tom & Friends' } });
  assert.equal(r.results[0].url, 'https://nebula.tv/tomandfriends');
  r = await env.send({ type: 'lookupChannel', info: { author: 'Tom & Friends' } });
  assert.equal(r.results[0]?.url, 'https://nebula.tv/tomandfriends');
  console.log('ok  creator wall parsed (entities, title-link fallback, name match)');
  // ---- security / bug-fix regressions ----

  // 12. A javascript: link from Nebula's API never reaches YouTube (video result dropped).
  env = makeEnv({ nebulaSubscribed: true }, [nebulaRoutes[0], nebulaRoutes[1],
    [/video_channels\/chan-1\/video_episodes/, { results: [{ title: 'Why Planes Don’t Fly Faster', published_at: '2024-03-01', share_url: 'javascript:alert(document.cookie)' }] }],
    [/search/, { results: [] }], [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'x1', title: 'Why Planes Don\'t Fly Faster', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' } });
  assert.ok(r.results.every(x => x.url.startsWith('https://')), JSON.stringify(r.results));
  console.log('ok  javascript: URL from the API is dropped');

  // 13. Ticking a subscription takes effect immediately (cached results are cleared).
  env = makeEnv({ nebulaSubscribed: false }, [...nebulaRoutes, [/floatplane/, new Error()]]);
  const vinfo = { videoId: 'x2', title: 'Why Planes Don\'t Fly Faster', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' };
  r = await env.send({ type: 'lookup', info: vinfo });
  assert.equal(r.results[0].subscribed, false);
  await env.chrome.storage.sync.set({ nebulaSubscribed: true });
  r = await env.send({ type: 'lookup', info: vinfo });
  assert.equal(r.results[0].subscribed, true);
  console.log('ok  settings change clears cached results');

  // 14. A failed lookup isn't cached: once Floatplane is reachable again, it's retried.
  const fpDown = [/floatplane/, new Error()];
  env = makeEnv({ floatplaneCreators: ['ltt'] }, [[/nebula/, new Error()], fpDown]);
  const tinfo = { videoId: 'x3', title: 'Nvidia did WHAT?', author: 'TechLinked', profileUrl: 'http://www.youtube.com/@TechLinked' };
  await env.send({ type: 'lookup', info: tinfo });
  env.routes.splice(env.routes.indexOf(fpDown), 1, ...fpRoutes);
  r = await env.send({ type: 'lookup', info: tinfo });
  assert.equal(r.results[0].url, 'https://www.floatplane.com/post/post1');
  console.log('ok  failed lookups are retried, not cached');

  // 15. "Refresh data" keeps dismissed banners.
  env = makeEnv({}, []);
  env.store.local.dismissedChannels = ['nebula:UCabc'];
  env.store.local.nebulaCreators = { t: 1, v: [] };
  await env.send({ type: 'clearCache' });
  assert.deepEqual(env.store.local.dismissedChannels, ['nebula:UCabc']);
  assert.equal(env.store.local.nebulaCreators, undefined);
  console.log('ok  refresh keeps dismissed banners');

  // 16. New-tab redirects open via the background, only for Nebula/Floatplane URLs.
  r = await env.send({ type: 'openTab', url: 'https://nebula.tv/videos/x' });
  assert.ok(r.ok && env.tabsOpened[0] === 'https://nebula.tv/videos/x');
  r = await env.send({ type: 'openTab', url: 'javascript:alert(1)' });
  assert.ok(r.error && env.tabsOpened.length === 1);
  r = await env.send({ type: 'openTab', url: 'https://evil.example/nebula.tv' });
  assert.ok(r.error && env.tabsOpened.length === 1);
  console.log('ok  openTab only opens Nebula/Floatplane URLs');

  // 17. Per-channel episode caches are pruned (storage doesn't grow forever).
  env = makeEnv({}, []);
  for (let i = 0; i < 70; i++) env.store.local[`neb:ch${i}`] = { t: i, v: [] };
  env.routes.push([/content\/fresh\/$/, { id: 'f1' }], [/video_channels\/f1\/video_episodes/, { results: [] }]);
  await env.send({ type: 'lookupChannel', info: {} }); // warm-up no-op
  // Trigger an episode-cache write through a lookup on a creator with slug "fresh".
  env.routes.unshift([/talent\.nebula\.tv\/creators/, '<div class="youtube-creator" data-video="UCfreshfreshfreshfresh01"><img alt="Fresh"><h3><a href="https://talent.nebula.tv/fresh/">Fresh</a></h3></div>']);
  await env.send({ type: 'lookup', info: { videoId: 'x4', title: 'anything', channelId: 'UCfreshfreshfreshfresh01', author: 'Fresh' } });
  const nebKeys = Object.keys(env.store.local).filter(k => k.startsWith('neb:'));
  assert.ok(nebKeys.length <= 60 && nebKeys.includes('neb:fresh'), String(nebKeys.length));
  console.log('ok  episode caches pruned to', nebKeys.length);
  // 18. Every request identifies Detour and its version (Floatplane asks API clients to), and a
  //     header rule sets it for extension-made requests only (tabId -1), not the user's tabs.
  env = makeEnv({ floatplaneCreators: ['ltt'] }, [...nebulaRoutes, ...fpRoutes]);
  await env.send({ type: 'lookup', info: { videoId: 'ua1', title: 'Nvidia did WHAT?', author: 'TechLinked', profileUrl: 'http://www.youtube.com/@TechLinked' } });
  assert.ok(env.calls.length > 0);
  // (The master list download on GitHub Pages sends no custom headers, to avoid a CORS preflight.)
  for (const c of env.calls.filter(c => !c.url.includes('github.io'))) assert.match(c.init.headers['User-Agent'], /Detour\/9\.9\.9 \(\+https:\/\/github\.com\/josh345rtfvqw\/detour\)$/, c.url);
  const rule = env.dnr[0].addRules[0];
  assert.equal(rule.action.requestHeaders[0].header, 'User-Agent');
  assert.match(rule.action.requestHeaders[0].value, /Detour\/9\.9\.9/);
  assert.deepEqual(rule.condition.tabIds, [-1]);
  assert.ok(rule.condition.requestDomains.includes('floatplane.com'));
  console.log('ok  User-Agent identifies Detour/<version> on all', env.calls.length, 'requests');
  // ---- master list (GitHub Pages) + local match cache ----
  const MASTER = /josh345rtfvqw\.github\.io\/detour\/data\/known\.json/;

  // 19. Master list hit: Nebula link comes from the list, no request to Nebula at all.
  const v3 = (extra) => ({ version: 3, videos: {}, channels: {}, nebula: { creators: {} }, floatplane: { creators: {} }, ...extra });
  env = makeEnv({ nebulaSubscribed: true }, [[MASTER, v3({ videos: { aaaaaaaaaaa: { nebula: 'known' } } })],
    [/nebula|talent/, new Error()], [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'aaaaaaaaaaa', title: 'Anything', author: 'Someone' } });
  assert.equal(r.results[0].url, 'https://nebula.tv/videos/known');
  assert.equal(r.results[0].confidence, 1);
  assert.ok(!env.calls.some(c => /nebula\.(app|tv)/.test(c.url)), 'no Nebula requests for a known video');
  console.log('ok  master list hit needs no Nebula requests');
  env = makeEnv({ nebulaSubscribed: true }, [[MASTER, v3({ videos: { podcastvid1: { nebula: 'modulus/finding-failures' } } })],
    [/nebula|talent/, new Error()], [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'podcastvid1', title: 'Anything', author: 'Someone' } });
  assert.equal(r.results[0].url, 'https://nebula.tv/modulus/finding-failures/');
  console.log('ok  master list podcast episodes link to nebula.tv/<show>/<episode>/');

  // 20. A tampered master list can't inject links: bad URLs are dropped, live lookup used instead.
  env = makeEnv({ nebulaSubscribed: true }, [[MASTER, v3({
    videos: { x2xxxxxxxxx: { nebula: '../evil', floatplane: 'javascript:alert(1)' }, bad: { nebula: 'y' }, x3xxxxxxxxx: { nebula: 'a/b/c' } },
    channels: { notachannel: { nebula: 'x' }, UCR1IuLEqb6UEA_zQ81kwXfg: { nebula: '../evil' } },
    nebula: { creators: { '../evil': { name: 'X' } } }, floatplane: { creators: { 'bad id!': { name: 'Evil' }, ok1: { name: 42 } } } })],
    ...nebulaRoutes, [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'x2xxxxxxxxx', title: 'Why Planes Don\'t Fly Faster', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' } });
  assert.equal(r.results[0].url, 'https://nebula.tv/videos/realengineering-why-planes');
  console.log('ok  invalid master list entries are ignored');

  // 21. Master list Floatplane creators (a new creator needs no release) are matched via the YouTube-keyed channels table, and a master Floatplane video is
  //     used without searching posts.
  const NEW_UC = 'UCnewcreator0000000000aa';
  env = makeEnv({ floatplaneCreators: ['newcreator1'] }, [[/nebula|talent/, new Error()],
    [MASTER, v3({ videos: { fpvideo0001: { floatplane: 'abc' } }, channels: { [NEW_UC]: { name: 'New Creator', floatplane: 'newcreator1' } },
      floatplane: { creators: { newcreator1: { name: 'New Creator', urlname: 'newcreator', channels: {}, catalog: false } } } })],
    [/floatplane\.com\/api\/v3\/creator\/list/, new Error()], [/content\/creator/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'fpvideo0001', title: 'x', author: 'Someone Else', channelId: NEW_UC } });
  assert.equal(r.results[0].url, 'https://www.floatplane.com/post/abc');
  assert.ok(r.results[0].subscribed);
  assert.ok(!env.calls.some(c => c.url.includes('content/creator')), 'no post search for a known video');
  const fpl = (await env.send({ type: 'fpCreators' })).creators;
  assert.deepEqual(fpl.map(c => c.title), ['New Creator'], 'creators come from the master list');
  console.log('ok  master list Floatplane creators and videos used');

  // 22. Local match cache: a live match is remembered; later, with Nebula unreachable, it still works.
  env = makeEnv({ nebulaSubscribed: true }, [...nebulaRoutes, [/floatplane/, new Error()]]);
  const cinfo = { videoId: 'cachedvid01', title: 'Why Planes Don\'t Fly Faster', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' };
  await env.send({ type: 'lookup', info: cinfo });
  assert.ok(env.store.local.matches['nebula:cachedvid01']);
  env.routes.length = 0; env.routes.push([/./, new Error()]);       // everything down now
  await env.chrome.storage.sync.set({ x: 1 });                        // clears the short-lived results cache
  const before = env.calls.length;
  r = await env.send({ type: 'lookup', info: cinfo });
  assert.equal(r.results[0].url, 'https://nebula.tv/videos/realengineering-why-planes');
  assert.ok(!env.calls.slice(before).some(c => /nebula\.(app|tv)/.test(c.url)), 'served from the local match cache');
  console.log('ok  confirmed matches are remembered locally');
  // 23. Nebula full catalogue: matched locally, no Nebula episode or search requests.
  env = makeEnv({ nebulaSubscribed: true }, [
    [MASTER, v3({ channels: { UCR1IuLEqb6UEA_zQ81kwXfg: { name: 'Real Engineering', nebula: 'realengineering' } }, nebula: { creators: { realengineering: { name: 'Real Engineering', catalog: true } } } })],
    [/detour\/data\/nebula\/realengineering\.json/, [{ s: 'realengineering-old-video', t: 'A Very Old Video About Dams', d: '2019-03-01' }, { s: '../evil', t: 'x' }, { s: 'ok', t: 42 }]],
    [/talent\.nebula\.tv/, new Error()], [/content\.api\.nebula\.app/, new Error()], [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'catneb00001', title: 'A Very Old Video About Dams', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' } });
  assert.equal(r.results[0].url, 'https://nebula.tv/videos/realengineering-old-video');
  assert.ok(!env.calls.some(c => c.url.includes('content.api.nebula.app') || c.url.includes('talent.nebula.tv')), 'no Nebula requests at all: creators and catalogue from the master list');
  console.log('ok  Nebula catalogue matched locally (bad entries ignored)');

  // 24. Floatplane full catalogue, filtered to the matched sub-channel; no post search.
  env = makeEnv({ floatplaneCreators: ['ltt'] }, [[/nebula|talent/, new Error()],
    [MASTER, v3({ channels: { UCeeFfhMcJa1kjtfZAGskOCA: { name: 'TechLinked', floatplane: 'ltt/chtl' } },
      floatplane: { creators: { ltt: { name: 'Linus Tech Tips', urlname: 'linustechtips', channels: { chtl: { name: 'TechLinked', urlname: 'techlinked' } }, catalog: true } } } })],
    [/detour\/data\/floatplane\/ltt\.json/, [
      { i: 'wrongch', t: 'Nvidia did WHAT?', d: '2024-05-02', c: 'chOther' },
      { i: 'rightch', t: 'Nvidia did WHAT? - TechLinked', d: '2024-05-02', c: 'chtl' }]],
    [/creator\/list/, new Error()], [/content\/creator/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'catfp000001', title: 'Nvidia did WHAT?', author: 'TechLinked', channelId: 'UCeeFfhMcJa1kjtfZAGskOCA', publishDate: '2024-05-03' } });
  assert.equal(r.results[0].url, 'https://www.floatplane.com/post/rightch', 'only the TechLinked sub-channel is considered');
  assert.ok(!env.calls.some(c => c.url.includes('content/creator')), 'no Floatplane post search with a full catalogue');
  console.log('ok  Floatplane catalogue matched locally, filtered by sub-channel');
  // 25. An older-version master list is ignored (falls back to live lookups), not misread.
  env = makeEnv({ nebulaSubscribed: true }, [[MASTER, { version: 2, nebula: { videos: { v1video0001: 'https://nebula.tv/videos/old' } } }], ...nebulaRoutes, [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'v1video0001', title: 'Why Planes Don\'t Fly Faster', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' } });
  assert.equal(r.results[0].url, 'https://nebula.tv/videos/realengineering-why-planes');
  console.log('ok  older master list versions ignored safely');

  // 26. Redirect threshold is fixed at 75%: an old saved strictness setting is ignored and cleared.
  env = makeEnv({ nebulaSubscribed: true, minConfidence: 0.9 }, [...nebulaRoutes, [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'thresh00001', title: 'Why Planes Don\'t Fly Faster', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' } });
  assert.equal(r.settings.minConfidence, 0.75);
  await new Promise(res => setTimeout(res, 0));
  assert.ok(!('minConfidence' in env.store.sync), 'old saved value cleared');
  console.log('ok  redirect threshold fixed at 75% (old setting ignored and cleared)');
  console.log('\nall tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
