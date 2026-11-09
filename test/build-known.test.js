// Tests scripts/build-known.js (known.json version 3) against mocked Nebula / YouTube / Floatplane.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { build, parseYouTubeFeed, youtubeLinkKey, channelIdFromPage } = require('../scripts/build-known.js');

const RE_UC = 'UCR1IuLEqb6UEA_zQ81kwXfg';
const TL_UC = 'UCeeFfhMcJa1kjtfZAGskOCA';
const LTT_UC = 'UCXuqSBlHAE6Xw-yeJA0Tunw';
const log = () => {};
const opts = (dir, extra = {}) => ({ dataDir: dir, log, delayMs: 0, retryBaseMs: 1, ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'known-'));
const readJ = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const ok = b => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => b, text: async () => (typeof b === 'string' ? b : JSON.stringify(b)) });
const notFound = { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };

const wall = `<div class="youtube-creator" data-video="${RE_UC}"><img alt="Real Engineering"><h3><a href="https://talent.nebula.tv/realengineering/">Real Engineering</a></h3><a class="link nebula" href="https://nebula.tv/realengineering">Nebula</a></div>`;
const feed = (entries) => `<feed>${entries.map(([id, title, date]) => `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><published>${date}T10:00:00+00:00</published></entry>`).join('')}</feed>`;

// A small fake internet. `state` lets a test change what the sites return between runs.
function makeNet(state) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (url.includes('talent.nebula.tv/creators')) return ok(wall);
    if (url.endsWith('/content/realengineering/')) return ok({ id: 'chan-1' });
    if (url.includes('video_channels/chan-1/video_episodes')) return ok({ results: state.nebEpisodes, next: null });
    const yf = url.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/);
    if (yf) return state.feeds[yf[1]] ? ok(feed(state.feeds[yf[1]])) : notFound;
    if (url === 'https://www.youtube.com/@techlinked') return ok(`<html><link rel="canonical" href="https://www.youtube.com/channel/${TL_UC}"></html>`);
    if (url === 'https://www.youtube.com/user/linustechtips') return ok(`<script>{"externalId":"${LTT_UC}"}</script>`);
    if (url.includes('www.floatplane.com')) {
      if (state.fpRefuse || (state.fpListRefuse && url.includes('/creator/list'))) return { ok: false, status: 403, headers: { get: k => (k === 'server' ? 'cloudflare' : null) }, text: async () => '{"message":"You must be logged-in to access this resource."}' };
      if (url.includes('/api/v3/creator/list')) return ok(state.fpCreators);
      if (url.includes('/api/v3/creator/named?')) {
        // Case-sensitive like the real thing: the address must match exactly.
        const asked = [...new URL(url).searchParams.entries()].filter(([k]) => /^creatorURL\[\d+\]$/.test(k)).map(([, v]) => v);
        state.namedAsked = [...(state.namedAsked || []), ...asked];
        return ok(asked.map(n => (state.fpNamed || {})[n]).filter(Boolean));
      }
      const m = url.match(/content\/creator\?id=(\w+)&limit=20&hasVideo=true&sort=DESC&fetchAfter=(\d+)/);
      if (m) return ok((state.fpPosts[m[1]] || []).slice(+m[2], +m[2] + 20));
    }
    return notFound;
  };
  return { fetchFn, calls };
}

const baseState = () => ({
  nebEpisodes: [
    { title: 'Why Planes Don’t Fly Faster', published_at: '2026-11-02', share_url: 'https://nebula.tv/videos/realengineering-why-planes' },
    { title: 'Bridges', published_at: '2026-10-01', share_url: 'javascript:alert(1)' }],
  feeds: {
    [RE_UC]: [['ytvideo0001', 'Why Planes Don&#39;t Fly Faster', '2026-11-03'], ['ytvideo0002', 'Totally Different Vlog', '2026-11-01']],
    [TL_UC]: [['tlvideo0001', 'Nvidia did WHAT?', '2026-11-04']],
  },
  fpCreators: [{ id: 'ltt', title: 'LinusTechTips', urlname: 'linustechtips', socialLinks: { youtube: 'https://www.youtube.com/user/LinusTechTips' },
    channels: [{ id: 'chTL', title: 'TechLinked', urlname: 'techlinked', socialLinks: { youtube: 'https://www.youtube.com/@TechLinked' } }] }],
  fpPosts: { ltt: [
    { id: 'p2', title: 'Nvidia did WHAT? - TechLinked', releaseDate: '2026-11-03T10:00:00Z', channel: { id: 'chTL' } },
    { id: 'p1', title: 'Some Main Channel Video', releaseDate: '2026-11-01T10:00:00Z', channel: 'chMain' }] },
  fpRefuse: false,
});

(async () => {
  // ---- helpers ----
  assert.deepEqual(parseYouTubeFeed(feed([['abcdefghijk', 'It&#39;s here', '2026-01-01']])).map(v => v.title), ["It's here"]);
  assert.equal(youtubeLinkKey('https://www.youtube.com/@TechLinked'), '@techlinked');
  assert.equal(youtubeLinkKey('https://www.youtube.com/user/LinusTechTips'), 'user:linustechtips');
  assert.equal(youtubeLinkKey(`https://www.youtube.com/channel/${RE_UC}`), `channel:${RE_UC}`);
  assert.equal(youtubeLinkKey('https://evil.example/@x'), null);
  assert.equal(channelIdFromPage(`<link rel="canonical" href="https://www.youtube.com/channel/${TL_UC}">`), TL_UC);
  console.log('ok  feed parsing, YouTube link keys, channel ID from page');

  // ---- full build ----
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'floatplane-creators.json'), JSON.stringify([{ id: null, title: 'Level1Techs', urlname: null, links: [], channels: [] }]));
  fs.writeFileSync(path.join(dir, 'overrides.json'), JSON.stringify({ videos: {
    manualvid01: { nebula: 'manual-slug' }, badvid00001: { nebula: '../evil' }, 'not-an-id': { nebula: 'x' }, fpmanual001: { floatplane: 'post9' } } }));
  const state = baseState();
  let net = makeNet(state);
  let r = await build({ ...opts(dir), fetchFn: net.fetchFn, now: new Date('2026-11-08T00:00:00Z') });
  let k = readJ(dir, 'known.json');
  assert.equal(k.version, 3);
  // videos: YouTube-keyed, one column per platform, IDs only
  assert.deepEqual(k.videos.ytvideo0001, { nebula: 'realengineering-why-planes' });
  assert.ok(!k.videos.ytvideo0002, 'unrelated YouTube video not matched');
  assert.deepEqual(k.videos.tlvideo0001, { floatplane: 'p2' }, 'Floatplane pre-matched against the TechLinked sub-channel only');
  assert.deepEqual(k.videos.manualvid01, { nebula: 'manual-slug' });
  assert.deepEqual(k.videos.fpmanual001, { floatplane: 'post9' });
  assert.ok(!k.videos.badvid00001 && !k.videos['not-an-id'], 'invalid overrides ignored');
  // channels: YouTube channel IDs only, handles resolved
  assert.deepEqual(k.channels[RE_UC], { name: 'Real Engineering', nebula: 'realengineering' });
  assert.deepEqual(k.channels[TL_UC], { name: 'TechLinked', floatplane: 'ltt/chTL' });
  assert.deepEqual(k.channels[LTT_UC], { name: 'LinusTechTips', floatplane: 'ltt' });
  assert.ok(Object.keys(k.channels).every(id => /^UC[\w-]{22}$/.test(id)), 'channels keyed by YouTube channel ID only');
  assert.ok(!('_fpCreators' in k) && !JSON.stringify(k.floatplane).includes('youtube.com'), 'no stored creator links in the index');
  // reference tables
  assert.deepEqual(k.nebula.creators.realengineering, { name: 'Real Engineering', catalog: true });
  assert.deepEqual(k.floatplane.creators.ltt, { name: 'LinusTechTips', urlname: 'linustechtips', channels: { chTL: { name: 'TechLinked', urlname: 'techlinked' } }, catalog: true });
  // handles remembered
  assert.deepEqual(readJ(dir, 'youtube-channels.json'), { '@techlinked': TL_UC, 'user:linustechtips': LTT_UC });
  // catalogues
  assert.deepEqual(readJ(dir, 'nebula/realengineering.json'), [{ s: 'realengineering-why-planes', t: 'Why Planes Don’t Fly Faster', d: '2026-11-02' }]);
  assert.deepEqual(readJ(dir, 'floatplane/ltt.json').map(p => p.i), ['p2', 'p1']);
  assert.ok(net.calls.every(c => /^DetourListBuilder\/1\.0 /.test(c.headers['User-Agent'])), 'identifies itself');
  console.log('ok  version 3: YouTube-keyed videos and channels, IDs only, both platforms pre-matched');

  // ---- second run: nothing new -> unchanged, handles not re-fetched, catalogues incremental ----
  net = makeNet(state);
  r = await build({ ...opts(dir), fetchFn: net.fetchFn, now: new Date('2026-11-09T00:00:00Z') });
  assert.equal(r.changed, false);
  assert.equal(readJ(dir, 'known.json').generated, '2026-11-08T00:00:00.000Z');
  assert.ok(!net.calls.some(c => c.url === 'https://www.youtube.com/@techlinked'), 'resolved handles are remembered');
  console.log('ok  quiet day: index unchanged, handles not looked up again');

  // ---- new Floatplane posts: only the newest page fetched ----
  state.fpPosts.ltt = [{ id: 'p3', title: 'Brand New', releaseDate: '2026-11-09T10:00:00Z', channel: 'chMain' }, ...state.fpPosts.ltt];
  net = makeNet(state);
  r = await build({ ...opts(dir), fetchFn: net.fetchFn, now: new Date('2026-11-10T00:00:00Z') });
  assert.equal(r.fpNew, 1);
  assert.deepEqual(readJ(dir, 'floatplane/ltt.json').map(p => p.i), ['p3', 'p2', 'p1']);
  assert.equal(net.calls.filter(c => c.url.includes('content/creator?id=ltt')).length, 1, 'stops at the first known post');
  console.log('ok  daily run fetches only the newest posts');

  // ---- null override removes a wrong match ----
  fs.writeFileSync(path.join(dir, 'overrides.json'), JSON.stringify({ videos: { tlvideo0001: { floatplane: null } } }));
  r = await build({ ...opts(dir), fetchFn: makeNet(state).fetchFn, now: new Date('2026-11-11T00:00:00Z') });
  assert.ok(!r.data.videos.tlvideo0001, 'null override removes the Floatplane match');
  console.log('ok  null override removes a match');

  // ---- Floatplane refuses: creators, channels and catalogues kept ----
  state.fpRefuse = true;
  net = makeNet(state);
  r = await build({ ...opts(dir), fetchFn: net.fetchFn, now: new Date('2026-11-12T00:00:00Z') });
  assert.ok(r.data.floatplane.creators.ltt && r.data.floatplane.creators.ltt.catalog, 'Floatplane creators kept');
  assert.equal(r.data.channels[TL_UC].floatplane, 'ltt/chTL', 'Floatplane channels kept');
  assert.equal(readJ(dir, 'floatplane/ltt.json').length, 3);
  console.log('ok  Floatplane refusal: previous creators, channels and catalogues kept');

  // ---- Creator list refused but posts allowed: the daily post fetch still runs ----
  state.fpRefuse = false;
  state.fpListRefuse = true;
  state.fpPosts.ltt = [{ id: 'p4', title: 'Even Newer', releaseDate: '2026-11-12T10:00:00Z', channel: 'chMain' }, ...state.fpPosts.ltt];
  net = makeNet(state);
  r = await build({ ...opts(dir), fetchFn: net.fetchFn, now: new Date('2026-11-13T00:00:00Z') });
  assert.equal(r.fpNew, 1, 'new post fetched although the creator list was refused');
  assert.equal(readJ(dir, 'floatplane/ltt.json')[0].i, 'p4');
  assert.equal(r.data.channels[TL_UC].floatplane, 'ltt/chTL', 'creators and channels kept from the previous run');
  console.log('ok  creator list refused: posts still fetched with known creator IDs');

  // ---- creator/named: fills in a creator known only by display name (list still refused) ----
  const L1_UC = 'UC4w1YQAJMWOz4qtxinq55LQ';
  state.fpNamed = { level1techs: { id: 'l1t', title: 'Level1Techs', urlname: 'level1techs', socialLinks: { youtube: 'https://www.youtube.com/@Level1Techs' }, channels: [] } };
  state.fpPosts.l1t = [{ id: 'l1p1', title: 'A Level1 Video', releaseDate: '2026-11-12T10:00:00Z', channel: 'chL1' }];
  state.namedAsked = [];
  const l1net = makeNet(state);
  const l1fetch = async (u, i) => (u === 'https://www.youtube.com/@level1techs' ? ok(`<link rel="canonical" href="https://www.youtube.com/channel/${L1_UC}">`) : l1net.fetchFn(u, i));
  r = await build({ ...opts(dir), fetchFn: l1fetch, now: new Date('2026-11-14T00:00:00Z') });
  assert.ok(state.namedAsked.includes('level1techs'), 'guessed address (from the display name) is lowercase');
  assert.deepEqual(r.data.floatplane.creators.l1t && r.data.floatplane.creators.l1t.name, 'Level1Techs', 'ID filled in from creator/named');
  assert.deepEqual(r.data.channels[L1_UC], { name: 'Level1Techs', floatplane: 'l1t' }, 'channels row from its YouTube link');
  assert.equal(readJ(dir, 'floatplane/l1t.json')[0].i, 'l1p1', 'its posts fetched too');
  console.log('ok  creator/named fills in IDs from a guessed address; posts then fetched');

  // ---- creator/named is case-sensitive: a stored mixed-case address is sent exactly as written ----
  const tmDir = tmp();
  const TM_UC = 'UCtylermcvicker000000000';
  fs.writeFileSync(path.join(tmDir, 'floatplane-creators.json'), JSON.stringify([{ id: 'tyler1', title: 'Tyler McVicker', urlname: 'TylerMcVicker', links: [], channels: [] }]));
  const tmState = { ...baseState(), fpListRefuse: true, fpCreators: [], fpPosts: { tyler1: [] },
    fpNamed: { TylerMcVicker: { id: 'tyler1', title: 'Tyler McVicker', urlname: 'TylerMcVicker', socialLinks: { youtube: 'https://www.youtube.com/@TylerMcVicker' }, channels: [] } }, namedAsked: [] };
  const tmNet = makeNet(tmState);
  r = await build({ ...opts(tmDir), fetchFn: async (u, i) => (u === 'https://www.youtube.com/@tylermcvicker' ? ok(`<link rel="canonical" href="https://www.youtube.com/channel/${TM_UC}">`) : tmNet.fetchFn(u, i)) });
  assert.ok(tmState.namedAsked.includes('TylerMcVicker') && !tmState.namedAsked.includes('tylermcvicker'), 'stored address sent with its exact case');
  assert.deepEqual(r.data.channels[TM_UC], { name: 'Tyler McVicker', floatplane: 'tyler1' }, 'its YouTube link fills the channels table');
  console.log('ok  stored mixed-case address sent exactly (creator/named is case-sensitive)');

  // ---- Anonymous only: no cookie or credential header is ever sent ----
  assert.ok(net.calls.every(c => !c.headers.Cookie && !c.headers.Authorization), 'no Cookie / Authorization headers');
  console.log('ok  all requests anonymous');

  // ---- rate limiting retried; network down survived ----
  const rlDir = tmp();
  let hits = 0;
  const rl = makeNet(baseState());
  r = await build({ ...opts(rlDir), fetchFn: async (u, i) => (u.includes('video_episodes') && hits++ < 2 ? { ok: false, status: 429, headers: { get: () => null } } : rl.fetchFn(u, i)) });
  assert.equal(r.nebNew, 1, '429 retried');
  r = await build({ ...opts(rlDir), fetchFn: async () => { throw new Error('offline'); } });
  assert.deepEqual(r.data.channels[RE_UC], { name: 'Real Engineering', nebula: 'realengineering' }, 'previous creators kept when offline');
  console.log('ok  rate limits retried, network outage survived');

  // ---- reads an older version-2 index ----
  const v2 = tmp();
  fs.writeFileSync(path.join(v2, 'known.json'), JSON.stringify({ version: 2, nebula: { videos: { oldvideo001: 'https://nebula.tv/videos/old-slug' } }, floatplane: { videos: {} } }));
  r = await build({ ...opts(v2), fetchFn: async () => notFound });
  assert.deepEqual(r.data.videos.oldvideo001, { nebula: 'old-slug' });
  console.log('ok  migrates a version-2 index');

  // ---- backfill: whole upload list from the YouTube Data API ----
  const bf = tmp();
  const bfState = baseState();
  bfState.nebEpisodes.push({ title: 'The Old Bridge Collapse Explained', published_at: '2019-03-01', share_url: 'https://nebula.tv/videos/realengineering-old-bridge' });
  const bfNet = makeNet(bfState);
  const apiCalls = [];
  const item = (videoId, title, date) => ({ snippet: { title, publishedAt: date, resourceId: { videoId } }, contentDetails: { videoId, videoPublishedAt: date } });
  const bfFetch = async (url, init) => {
    if (url.startsWith('https://www.googleapis.com/youtube/v3/playlistItems')) {
      apiCalls.push({ url, key: init.headers['X-Goog-Api-Key'] });
      const u = new URL(url);
      if (u.searchParams.get('playlistId') !== 'UU' + RE_UC.slice(2)) return notFound;
      return u.searchParams.get('pageToken') === 'p2'
        ? ok({ items: [item('oldbridge01', 'The Old Bridge Collapse Explained', '2019-03-02T10:00:00Z'), item('privatevid1', 'Private video', '2019-01-01T00:00:00Z')] })
        : ok({ items: [item('ytvideo0001', 'Why Planes Don\'t Fly Faster', '2026-11-03T10:00:00Z')], nextPageToken: 'p2' });
    }
    return bfNet.fetchFn(url, init);
  };
  r = await build({ ...opts(bf), fetchFn: bfFetch, backfill: true, youtubeApiKey: 'test-key' });
  assert.deepEqual(r.data.videos.oldbridge01, { nebula: 'realengineering-old-bridge' }, 'older video matched from the API upload list');
  assert.equal(r.data.videos.privatevid1, undefined);
  assert.ok(apiCalls.length >= 2 && apiCalls.every(c => c.key === 'test-key' && !c.url.includes('test-key')), 'key sent in a header, never in the URL');
  const bf2 = tmp();
  r = await build({ ...opts(bf2), fetchFn: bfFetch, backfill: true, youtubeApiKey: '' });
  assert.equal(r.data.videos.oldbridge01, undefined, 'no key: falls back to RSS');
  console.log('ok  backfill pages through the full upload list');
  console.log('\nall build-known tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
