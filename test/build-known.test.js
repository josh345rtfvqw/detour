// Tests scripts/build-known.js against mocked Nebula / YouTube responses.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { build, parseYouTubeFeed } = require('../scripts/build-known.js');

const wall = `<div class="youtube-creator" data-video="UCR1IuLEqb6UEA_zQ81kwXfg"><img alt="Real Engineering"><h3><a href="https://talent.nebula.tv/realengineering/">Real Engineering</a></h3><a class="link nebula" href="https://nebula.tv/realengineering">Nebula</a></div>`;
const feed = `<feed><entry><yt:videoId>ytvideo0001</yt:videoId><title>Why Planes Don&#39;t Fly Faster</title><published>2026-11-03T10:00:00+00:00</published></entry>
<entry><yt:videoId>ytvideo0002</yt:videoId><title>Totally Different Vlog</title><published>2026-11-01T10:00:00+00:00</published></entry></feed>`;
const episodes = { results: [{ title: 'Why Planes Don’t Fly Faster', published_at: '2026-11-02', share_url: 'https://nebula.tv/videos/realengineering-why-planes' },
  { title: 'Bridges', published_at: '2026-10-01', share_url: 'javascript:alert(1)' }] };

function mockFetch(calls) {
  return async (url, init) => {
    calls.push({ url, init });
    const ok = b => ({ ok: true, status: 200, json: async () => b, text: async () => (typeof b === 'string' ? b : JSON.stringify(b)) });
    if (url.includes('talent.nebula.tv/creators')) return ok(wall);
    if (url.includes('youtube.com/feeds/videos.xml?channel_id=UCR1IuLEqb6UEA_zQ81kwXfg')) return ok(feed);
    if (url.endsWith('/content/realengineering/')) return ok({ id: 'chan-1' });
    if (url.includes('video_channels/chan-1/video_episodes')) return ok(episodes);
    return { ok: false, status: 404 };
  };
}

(async () => {
  assert.deepEqual(parseYouTubeFeed(feed).map(v => v.videoId), ['ytvideo0001', 'ytvideo0002']);
  assert.equal(parseYouTubeFeed(feed)[0].title, "Why Planes Don't Fly Faster");
  console.log('ok  YouTube feed parsed (entities decoded)');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'known-'));
  fs.writeFileSync(path.join(dir, 'floatplane-creators.json'), JSON.stringify([{ id: 'c1', title: 'Creator One', urlname: 'one', links: [], channels: [] }]));
  fs.writeFileSync(path.join(dir, 'overrides.json'), JSON.stringify({ nebula: { manualvid01: 'https://nebula.tv/videos/manual', badvid00001: 'https://evil.example/x', 'not-an-id': 'https://nebula.tv/x' }, floatplane: { fpvideo0001: 'https://www.floatplane.com/post/p1' } }));
  const calls = [];
  const log = () => {};
  let r = await build({ fetchFn: mockFetch(calls), dataDir: dir, now: new Date('2026-11-08T00:00:00Z'), log, delayMs: 0 });
  const known = JSON.parse(fs.readFileSync(path.join(dir, 'known.json'), 'utf8'));
  assert.equal(known.version, 1);
  assert.equal(known.nebula.ytvideo0001, 'https://nebula.tv/videos/realengineering-why-planes');
  assert.ok(!('ytvideo0002' in known.nebula), 'unrelated video not matched');
  assert.equal(known.nebula.manualvid01, 'https://nebula.tv/videos/manual');
  assert.ok(!('badvid00001' in known.nebula) && !('not-an-id' in known.nebula), 'invalid overrides ignored');
  assert.equal(known.floatplane.fpvideo0001, 'https://www.floatplane.com/post/p1');
  assert.equal(known.floatplaneCreators[0].title, 'Creator One');
  assert.ok(calls.every(c => /^DetourListBuilder\/1\.0 /.test(c.init.headers['User-Agent'])), 'identifies itself');
  console.log('ok  list built: auto match, overrides, Floatplane creators, User-Agent');

  // Second run with nothing new: no change, "generated" kept, and no Nebula requests for known videos.
  const calls2 = [];
  r = await build({ fetchFn: mockFetch(calls2), dataDir: dir, now: new Date('2026-11-09T00:00:00Z'), log, delayMs: 0 });
  assert.equal(r.changed, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'known.json'), 'utf8')).generated, '2026-11-08T00:00:00.000Z');
  console.log('ok  unchanged run keeps the file identical (no commit)');

  // A null override removes a wrong automatic match.
  fs.writeFileSync(path.join(dir, 'overrides.json'), JSON.stringify({ nebula: { ytvideo0001: null } }));
  r = await build({ fetchFn: mockFetch([]), dataDir: dir, now: new Date('2026-11-10T00:00:00Z'), log, delayMs: 0 });
  assert.ok(r.changed && !('ytvideo0001' in r.data.nebula));
  console.log('ok  null override removes an entry');

  // Network down: existing entries are kept, nothing breaks.
  fs.writeFileSync(path.join(dir, 'overrides.json'), '{}');
  const down = async () => { throw new Error('offline'); };
  r = await build({ fetchFn: down, dataDir: dir, now: new Date('2026-11-11T00:00:00Z'), log, delayMs: 0 });
  assert.equal(r.data.floatplaneCreators[0].title, 'Creator One');
  console.log('ok  survives the network being down');
  console.log('\nall build-known tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
