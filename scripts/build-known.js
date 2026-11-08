// Builds data/known.json: the master list the extension downloads daily from GitHub Pages
// (https://josh345rtfvqw.github.io/detour/data/known.json). Run daily by
// .github/workflows/update-list.yml, or by hand:  node scripts/build-known.js
//
// It contains:
//  - nebula:             YouTube video ID -> Nebula video URL. Built automatically: for each
//                        creator on Nebula's creator wall, their latest YouTube uploads (public
//                        RSS feed) are matched by title and date against their Nebula videos.
//                        Entries accumulate; existing ones are kept.
//  - floatplane:         YouTube video ID -> Floatplane post URL (from overrides only; Floatplane's
//                        post search needs a login, so it isn't automated).
//  - floatplaneCreators: from data/floatplane-creators.json (edited by hand).
// data/overrides.json is applied last: a URL adds or replaces an entry, null removes one.
const fs = require('fs');
const path = require('path');
const { bestMatch, parseCreatorWall, decodeHtml } = require('../match.js');

const UA = 'DetourListBuilder/1.0 (+https://github.com/josh345rtfvqw/detour)';
const NEBULA_API = 'https://content.api.nebula.app';
const MIN_CONFIDENCE = 0.85; // stricter than the extension: these are shared with every user
const MAX_ENTRIES = 50000;
const ALLOWED_HOSTS = new Set(['nebula.tv', 'www.nebula.tv', 'nebula.app', 'www.nebula.app', 'floatplane.com', 'www.floatplane.com']);
const isAllowedUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && ALLOWED_HOSTS.has(x.hostname); } catch { return false; } };
const YT_ID = /^[\w-]{11}$/;

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const sortObject = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

// YouTube's public per-channel feed: the latest ~15 uploads.
function parseYouTubeFeed(xml) {
  return xml.split('<entry>').slice(1).map(e => ({
    videoId: (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1],
    title: decodeHtml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(),
    date: (e.match(/<published>([^<]+)<\/published>/) || [])[1],
  })).filter(v => v.videoId && v.title);
}

async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function build({ fetchFn = fetch, dataDir = path.join(__dirname, '..', 'data'), now = new Date(), log = console.log, delayMs = 150 } = {}) {
  const get = async (url, type = 'json') => {
    const res = await fetchFn(url, { headers: { 'User-Agent': UA, 'Accept': type === 'json' ? 'application/json' : '*/*' } });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return type === 'json' ? res.json() : res.text();
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const knownFile = path.join(dataDir, 'known.json');
  const previous = readJson(knownFile, {});
  const nebula = { ...(previous.nebula || {}) };
  const overrides = readJson(path.join(dataDir, 'overrides.json'), {});
  const floatplaneCreators = readJson(path.join(dataDir, 'floatplane-creators.json'), []);

  // 1. Creators on Nebula with a YouTube channel.
  let creators = [];
  try {
    creators = parseCreatorWall(await get('https://talent.nebula.tv/creators/', 'text')).filter(c => c.ytId);
    log(`creator wall: ${creators.length} creators with a YouTube channel`);
  } catch (e) { log(`creator wall failed: ${e.message}`); }

  // 2. For each, match recent YouTube uploads to Nebula videos.
  let added = 0, failed = 0;
  await mapLimit(creators, 3, async c => {
    try {
      const feed = parseYouTubeFeed(await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.ytId}`, 'text'));
      const fresh = feed.filter(v => !nebula[v.videoId]);
      if (!fresh.length) return;
      const slugs = [...new Set([c.slug, c.alt].filter(Boolean))];
      const episodes = [];
      for (const slug of slugs) {
        try {
          const channel = await get(`${NEBULA_API}/content/${slug}/`);
          const body = await get(`${NEBULA_API}/video_channels/${channel.id}/video_episodes/?page_size=100`);
          episodes.push(...body.results.map(v => ({ title: v.title, date: v.published_at, url: v.share_url || `https://nebula.tv/videos/${v.slug}` })));
        } catch (e) { /* try the other slug */ }
      }
      for (const v of fresh) {
        const m = bestMatch(v.title, v.date, episodes);
        if (m && m.confidence >= MIN_CONFIDENCE && isAllowedUrl(m.url)) { nebula[v.videoId] = m.url; added++; }
      }
    } catch (e) { failed++; }
    if (delayMs) await sleep(delayMs);
  });
  log(`matched ${added} new videos (${failed} creators failed)`);

  // 3. Manual overrides win.
  const floatplane = {};
  for (const [section, target] of [['nebula', nebula], ['floatplane', floatplane]]) {
    for (const [id, url] of Object.entries(overrides[section] || {})) {
      if (!YT_ID.test(id)) continue;
      if (url === null) delete target[id];
      else if (isAllowedUrl(url)) target[id] = url;
    }
  }

  // Keep the list bounded (only reached if it ever grows past MAX_ENTRIES).
  const nebulaEntries = Object.entries(nebula);
  const kept = Object.fromEntries(nebulaEntries.slice(Math.max(0, nebulaEntries.length - MAX_ENTRIES)));

  const data = { version: 1, nebula: sortObject(kept), floatplane: sortObject(floatplane), floatplaneCreators };
  // Only bump "generated" when the content changes, so unchanged days produce no commit.
  const { generated: _g, ...prevContent } = previous;
  const changed = JSON.stringify(prevContent) !== JSON.stringify(data);
  const out = { version: 1, generated: changed ? now.toISOString() : (previous.generated || now.toISOString()), ...data };
  fs.writeFileSync(knownFile, JSON.stringify(out) + '\n');
  log(`${changed ? 'updated' : 'unchanged'}: ${Object.keys(out.nebula).length} Nebula videos, ${Object.keys(out.floatplane).length} Floatplane videos, ${floatplaneCreators.length} Floatplane creators`);
  return { changed, added, data: out };
}

if (require.main === module) build().catch(e => { console.error(e); process.exit(1); });
module.exports = { build, parseYouTubeFeed };
