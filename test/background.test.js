// Runs background.js against mocked chrome.* and fetch, to check matching + redirect decisions.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');

function makeEnv(sync, routes) {
  const store = { sync: { ...sync }, local: {} };
  const area = s => ({
    get: async keys => { const out = {}; const def = typeof keys === 'string' ? { [keys]: undefined } : keys;
      for (const k of Object.keys(def)) out[k] = k in s ? s[k] : def[k]; return out; },
    set: async o => Object.assign(s, o), clear: async () => { for (const k in s) delete s[k]; },
  });
  let listener;
  const calls = [];
  const ctx = {
    console: { log() {}, warn() {} }, URL, URLSearchParams, Date, Promise, Map, Set, encodeURIComponent,
    chrome: { storage: { sync: area(store.sync), local: area(store.local) }, runtime: { onMessage: { addListener: f => (listener = f) } } },
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
  return { send, calls };
}

const nebulaRoutes = [
  [/channels\.json$/, [{ name: 'Real Engineering', nebula: 'realengineering', nebulaAlt: 'realengineering', channel: 'UCR1IuLEqb6UEA_zQ81kwXfg' }]],
  [/talent\.nebula\.tv/, ''],
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
  env = makeEnv({ floatplaneCreators: ['ltt'] }, [[/nebula|githubusercontent/, new Error()], ...fpRoutes]);
  r = await env.send({ type: 'lookup', info: { videoId: 'c', title: 'Nvidia did WHAT?', channelId: 'UCeeFfhMcJa1kjtfZAGskOCA', author: 'TechLinked', profileUrl: 'http://www.youtube.com/@TechLinked', publishDate: '2024-05-03' } });
  assert.equal(r.results[0].platform, 'floatplane');
  assert.equal(r.results[0].url, 'https://www.floatplane.com/post/post1');
  assert.ok(r.results[0].subscribed);
  const fpCall = env.calls.find(c => c.url.includes('floatplane'));
  assert.equal(fpCall.init.credentials, 'include');
  console.log('ok  floatplane channel match via handle, uses login cookies', r.results[0].confidence.toFixed(2));

  // 4. Same but not subscribed -> result present, subscribed=false (button only)
  env = makeEnv({ floatplaneCreators: [] }, [[/nebula|githubusercontent/, new Error()], ...fpRoutes]);
  r = await env.send({ type: 'lookup', info: { videoId: 'c', title: 'Nvidia did WHAT?', author: 'TechLinked', profileUrl: 'http://www.youtube.com/@TechLinked' } });
  assert.equal(r.results[0].subscribed, false);
  console.log('ok  not subscribed -> no auto-redirect flag');

  // 5. Nebula API down -> RSS fallback
  const rss = `<rss><channel><item><title><![CDATA[Why Planes Don&apos;t Fly Faster]]></title><link>https://nebula.tv/videos/realengineering-why-planes</link><pubDate>Fri, 01 Mar 2024 00:00:00 GMT</pubDate></item></channel></rss>`;
  env = makeEnv({ nebulaSubscribed: true }, [nebulaRoutes[0], nebulaRoutes[1], [/content\.api\.nebula/, new Error()], [/rss\.nebula\.app\/video\/channels\/realengineering\.rss/, rss], [/floatplane/, new Error()]]);
  r = await env.send({ type: 'lookup', info: { videoId: 'd', title: 'Why Planes Don\'t Fly Faster', channelId: 'UCR1IuLEqb6UEA_zQ81kwXfg', author: 'Real Engineering' } });
  assert.equal(r.results[0].kind, 'video');
  assert.equal(r.results[0].url, 'https://nebula.tv/videos/realengineering-why-planes');
  console.log('ok  RSS fallback when Nebula API fails');

  // 6. Channel on neither platform -> no results
  r = await env.send({ type: 'lookup', info: { videoId: 'e', title: 'x', channelId: 'UCnope', author: 'Someone Else' } });
  assert.equal(r.results.length, 0);
  console.log('ok  unrelated channel -> nothing shown');
  console.log('\nall tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
