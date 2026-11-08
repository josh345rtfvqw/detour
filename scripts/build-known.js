// Builds the master list the extension downloads from GitHub Pages
// (https://josh345rtfvqw.github.io/detour/data/...). Run daily by
// .github/workflows/update-list.yml, or by hand:  node scripts/build-known.js
//
// Output:
//  data/known.json   small index, downloaded by every user about twice a day (version 2):
//    nebula.videos        YouTube video ID -> Nebula URL, pre-matched from each Nebula creator's
//                         latest YouTube uploads (public RSS feed), plus overrides. Accumulates.
//    nebula.creators      Nebula's creator list: name, slug (alt), YouTube channel ID, and
//                         catalog: true when data/nebula/<slug>.json exists.
//    floatplane.videos    YouTube video ID -> Floatplane post URL (overrides).
//    floatplane.creators  data/floatplane-creators.json (hand-edited), filled in and extended
//                         with Floatplane's own creator list; catalog: true when
//                         data/floatplane/<id>.json exists.
//  data/nebula/<slug>.json       every video of that Nebula channel: [{ s: slug, t: title, d: date }]
//  data/floatplane/<id>.json     every video post of that Floatplane creator: [{ i, t, d, c: channel }]
//
// Catalogues are incremental: the first run pages back through each creator's whole history;
// later runs fetch pages only until they reach a video already stored, so the daily job is
// just the newest uploads. Everything is fetched without logging in. If a source refuses, that
// part is skipped and the previous data is kept.
// data/overrides.json is applied last: a URL adds or replaces a pre-matched entry, null removes it.
const fs = require('fs');
const path = require('path');
const { bestMatch, parseCreatorWall, decodeHtml, SLUG } = require('../match.js');
const { fpNameKey } = require('../floatplane-defaults.js');

const UA = 'DetourListBuilder/1.0 (+https://github.com/josh345rtfvqw/detour)';
const NEBULA_API = 'https://content.api.nebula.app';
const FP = 'https://www.floatplane.com';
const FP_ID = /^\w{1,64}$/;
const MIN_CONFIDENCE = 0.85; // stricter than the extension: pre-matches are shared with every user
const MAX_ENTRIES = 50000;
const MAX_PAGES = 1000;      // safety stop per creator
const ALLOWED_HOSTS = new Set(['nebula.tv', 'www.nebula.tv', 'nebula.app', 'www.nebula.app', 'floatplane.com', 'www.floatplane.com']);
const isAllowedUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && ALLOWED_HOSTS.has(x.hostname); } catch { return false; } };
const YT_ID = /^[\w-]{11}$/;

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const sortObject = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const writeIfChanged = (file, data) => {
  const text = JSON.stringify(data) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
};
const nebulaSlugFromUrl = u => { try { const m = new URL(u).pathname.match(/^\/videos\/([\w-]+)\/?$/); return m ? m[1] : null; } catch { return null; } };

// YouTube's public per-channel feed: the latest ~15 uploads.
function parseYouTubeFeed(xml) {
  return xml.split('<entry>').slice(1).map(e => ({
    videoId: (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1],
    title: decodeHtml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(),
    date: (e.match(/<published>([^<]+)<\/published>/) || [])[1],
  })).filter(v => v.videoId && v.title);
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

// ------------------------------------------------------------------ Nebula catalogue

// Newest-first pages of a Nebula channel, stopping at the first episode already stored.
async function updateNebulaCatalog({ get, sleep, delayMs, slug, existing }) {
  const known = new Set(existing.map(e => e.s));
  const channel = await get(`${NEBULA_API}/content/${slug}/`);
  let url = `${NEBULA_API}/video_channels/${channel.id}/video_episodes/?page_size=100`;
  const fresh = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const body = await get(url);
    let reachedKnown = false;
    for (const v of body.results || []) {
      const s = nebulaSlugFromUrl(v.share_url || '') || (SLUG.test(v.slug || '') ? v.slug : null);
      if (!s || typeof v.title !== 'string') continue;
      if (known.has(s)) { reachedKnown = true; break; }
      fresh.push({ s, t: v.title, d: (v.published_at || '').slice(0, 10) });
      known.add(s);
    }
    if (reachedKnown) break;
    url = body.next && body.next.startsWith(NEBULA_API) ? body.next : null;
    if (url && delayMs) await sleep(delayMs);
  }
  return [...fresh, ...existing];
}

// ------------------------------------------------------------------ Floatplane

async function buildFloatplaneCreators({ get, log, handCreators, previousCreators = [] }) {
  const links = o => Object.values(o || {}).filter(l => typeof l === 'string');
  const creators = handCreators.map(c => ({ ...c, channels: [...(c.channels || [])] }));
  try {
    const live = await get(`${FP}/api/v3/creator/list?search=`);
    if (!Array.isArray(live)) throw new Error('unexpected response');
    for (const lc of live) {
      if (!lc || !FP_ID.test(lc.id || '') || typeof lc.title !== 'string') continue;
      const entry = {
        id: lc.id, title: lc.title, urlname: lc.urlname || null, links: links(lc.socialLinks),
        channels: (lc.channels || []).filter(ch => ch && FP_ID.test(ch.id || '')).map(ch => ({ id: ch.id, title: ch.title, urlname: ch.urlname || null, links: links(ch.socialLinks) })),
      };
      const existing = creators.find(c => c.id === lc.id) || creators.find(c => fpNameKey(c.title) === fpNameKey(lc.title));
      if (!existing) { creators.push(entry); continue; }
      // Live data fills gaps; hand-entered YouTube links are kept.
      existing.id = entry.id; existing.urlname = entry.urlname || existing.urlname;
      existing.links = [...new Set([...(existing.links || []), ...entry.links])];
      for (const ch of entry.channels) {
        const ec = existing.channels.find(x => x.id === ch.id);
        if (!ec) existing.channels.push(ch);
        else { ec.urlname = ch.urlname || ec.urlname; ec.links = [...new Set([...(ec.links || []), ...ch.links])]; }
      }
    }
    log(`floatplane creator list: ${live.length} creators`);
    return { creators, authRequired: false };
  } catch (e) {
    const authRequired = /^40[13] /.test(e.message);
    log(`floatplane creator list failed: ${e.message}${authRequired ? ' (refused: login or bot protection, see the "refused by" line)' : ''}`);
    // Keep the previous run's list (with IDs filled in from Floatplane), plus any creators
    // added by hand since.
    if (previousCreators.length) {
      const kept = previousCreators.map(({ catalog, ...c }) => c);
      for (const h of creators) if (!kept.some(k => (h.id && k.id === h.id) || fpNameKey(k.title) === fpNameKey(h.title))) kept.push(h);
      return { creators: kept, authRequired };
    }
    return { creators, authRequired };
  }
}

// Newest-first pages of a Floatplane creator's video posts, stopping at the first one stored.
async function updateFloatplaneCatalog({ get, sleep, delayMs, id, existing }) {
  const known = new Set(existing.map(p => p.i));
  const fresh = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const posts = await get(`${FP}/api/v3/content/creator?id=${id}&limit=20&hasVideo=true&sort=DESC&fetchAfter=${page * 20}`);
    if (!Array.isArray(posts)) throw new Error('unexpected response');
    let reachedKnown = false;
    for (const p of posts) {
      if (!p || !FP_ID.test(p.id || '') || typeof p.title !== 'string') continue;
      if (known.has(p.id)) { reachedKnown = true; break; }
      const ch = typeof p.channel === 'string' ? p.channel : p.channel?.id;
      fresh.push({ i: p.id, t: p.title, d: (p.releaseDate || '').slice(0, 10), ...(ch && FP_ID.test(ch) ? { c: ch } : {}) });
      known.add(p.id);
    }
    if (reachedKnown || posts.length < 20) break;
    if (delayMs) await sleep(delayMs);
  }
  return [...fresh, ...existing];
}

// ------------------------------------------------------------------ build

async function build({ fetchFn = fetch, dataDir = path.join(__dirname, '..', 'data'), now = new Date(), log = console.log, delayMs = 400, retryBaseMs = 2000 } = {}) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const failures = {};          // "host status" -> count, for the log
  const refusalsLogged = new Set();
  // GET with polite retries: on 429 (rate limited) or 5xx, wait (Retry-After if given, else
  // exponential back-off) and try again, up to 4 times. Refusals are logged once per host.
  const get = async (url, type = 'json') => {
    const host = (() => { try { return new URL(url).hostname; } catch { return '?'; } })();
    for (let attempt = 0; ; attempt++) {
      let res;
      try { res = await fetchFn(url, { headers: { 'User-Agent': UA, 'Accept': type === 'json' ? 'application/json' : '*/*' } }); }
      catch (e) { if (attempt < 3) { await sleep(retryBaseMs * 2 ** attempt); continue; } failures[`${host} network`] = (failures[`${host} network`] || 0) + 1; throw e; }
      if (res.ok) return type === 'json' ? res.json() : res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < 4) {
        const ra = Number(res.headers?.get?.('retry-after'));
        await sleep(ra > 0 ? Math.min(ra, 120) * 1000 : retryBaseMs * 2 ** attempt);
        continue;
      }
      failures[`${host} ${res.status}`] = (failures[`${host} ${res.status}`] || 0) + 1;
      if ((res.status === 401 || res.status === 403) && !refusalsLogged.has(host)) {
        refusalsLogged.add(host);
        let body = ''; try { body = (await res.text()).replace(/\s+/g, ' ').slice(0, 200); } catch { /* ignore */ }
        const h = k => res.headers?.get?.(k) || '';
        log(`refused by ${host}: ${res.status} server=${h('server')} cf-ray=${h('cf-ray') ? 'yes' : 'no'} cf-mitigated=${h('cf-mitigated')} body="${body}"`);
      }
      throw new Error(`${res.status} ${url}`);
    }
  };

  const knownFile = path.join(dataDir, 'known.json');
  const previous = readJson(knownFile, {});
  // Pre-matched videos from the previous run (version 2 layout, or the older flat version 1).
  const prevNebulaVideos = previous.version === 2 ? previous.nebula?.videos : previous.nebula;
  const nebula = { ...(prevNebulaVideos || {}) };
  const overrides = readJson(path.join(dataDir, 'overrides.json'), {});
  const handCreators = readJson(path.join(dataDir, 'floatplane-creators.json'), []);
  const nebulaDir = path.join(dataDir, 'nebula');
  const fpDir = path.join(dataDir, 'floatplane');

  // 1. Nebula: creators, their full catalogues, and pre-matches for their latest YouTube uploads.
  let creators = [];
  try {
    creators = parseCreatorWall(await get('https://talent.nebula.tv/creators/', 'text'));
    log(`creator wall: ${creators.length} creators (${creators.filter(c => c.ytId).length} with a YouTube channel)`);
  } catch (e) { log(`creator wall failed: ${e.message}`); }

  let nebNew = 0, nebFailed = 0, matched = 0;
  await mapLimit(creators, 2, async c => {
    const episodes = [];
    for (const slug of [...new Set([c.slug, c.alt].filter(s => s && SLUG.test(s)))]) {
      const file = path.join(nebulaDir, `${slug}.json`);
      const existing = readJson(file, []);
      try {
        const updated = await updateNebulaCatalog({ get, sleep, delayMs, slug, existing });
        nebNew += updated.length - existing.length;
        writeIfChanged(file, updated);
        episodes.push(...updated);
      } catch (e) { nebFailed++; episodes.push(...existing); }
    }
    if (!c.ytId || !episodes.length) return;
    try {
      const feed = parseYouTubeFeed(await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.ytId}`, 'text'));
      const cands = episodes.map(e => ({ title: e.t, date: e.d, url: `https://nebula.tv/videos/${e.s}` }));
      for (const v of feed.filter(v => !nebula[v.videoId])) {
        const m = bestMatch(v.title, v.date, cands);
        if (m && m.confidence >= MIN_CONFIDENCE && isAllowedUrl(m.url)) { nebula[v.videoId] = m.url; matched++; }
      }
    } catch (e) { /* feed unavailable today */ }
    if (delayMs) await sleep(delayMs);
  });
  log(`nebula: ${nebNew} new catalogue videos (${nebFailed} channels failed), ${matched} new YouTube pre-matches`);
  if (Object.keys(failures).length) log(`request failures so far: ${JSON.stringify(failures)}`);

  // 2. Floatplane: creator list and full catalogues.
  const previousFpCreators = previous.version === 2 ? previous.floatplane?.creators || [] : [];
  const { creators: fpCreators, authRequired } = await buildFloatplaneCreators({ get, log, handCreators, previousCreators: previousFpCreators });
  let fpNew = 0, fpFailed = 0;
  if (authRequired) log('floatplane catalogues skipped: Floatplane refused the creator list; previous data kept');
  else {
    await mapLimit(fpCreators.filter(c => FP_ID.test(c.id || '')), 1, async c => {
      const file = path.join(fpDir, `${c.id}.json`);
      const existing = readJson(file, []);
      try {
        const updated = await updateFloatplaneCatalog({ get, sleep, delayMs, id: c.id, existing });
        fpNew += updated.length - existing.length;
        writeIfChanged(file, updated);
      } catch (e) { fpFailed++; }
    });
    log(`floatplane: ${fpNew} new catalogue posts (${fpFailed} creators failed)`);
  }

  // 3. Manual overrides win.
  const floatplane = {};
  for (const [section, target] of [['nebula', nebula], ['floatplane', floatplane]]) {
    for (const [id, url] of Object.entries(overrides[section] || {})) {
      if (!YT_ID.test(id)) continue;
      if (url === null) delete target[id];
      else if (isAllowedUrl(url)) target[id] = url;
    }
  }

  // 4. The index: videos and creators per platform; catalog: true where a non-empty file exists.
  const hasCatalog = (dir, name) => readJson(path.join(dir, `${name}.json`), []).length > 0;
  const nebulaCreators = creators.map(c => ({
    name: c.name, slug: c.slug, ...(c.alt ? { alt: c.alt } : {}), ...(c.ytId ? { youtube: c.ytId } : {}),
    catalog: [c.slug, c.alt].filter(Boolean).some(s => hasCatalog(nebulaDir, s)),
  }));
  // If the creator wall couldn't be read this time, keep yesterday's list.
  const prevNebulaCreators = previous.version === 2 ? previous.nebula?.creators || [] : [];
  const fpIndexCreators = fpCreators.map(c => ({ ...c, catalog: FP_ID.test(c.id || '') && hasCatalog(fpDir, c.id) }));

  const nebulaEntries = Object.entries(nebula);
  const kept = Object.fromEntries(nebulaEntries.slice(Math.max(0, nebulaEntries.length - MAX_ENTRIES)));
  const data = {
    version: 2,
    nebula: { videos: sortObject(kept), creators: nebulaCreators.length ? nebulaCreators : prevNebulaCreators },
    floatplane: { videos: sortObject(floatplane), creators: fpIndexCreators },
  };
  // Only bump "generated" when the index changes, so quiet days don't rewrite it.
  const { generated: _g, ...prevContent } = previous;
  const changed = JSON.stringify(prevContent) !== JSON.stringify(data);
  const out = { version: 2, generated: changed ? now.toISOString() : (previous.generated || now.toISOString()), ...data };
  writeIfChanged(knownFile, out);
  if (Object.keys(failures).length) log(`request failures (after retries): ${JSON.stringify(failures)}`);
  const count = (dir, names) => names.reduce((n, x) => n + readJson(path.join(dir, `${x}.json`), []).length, 0);
  const nebCat = out.nebula.creators.filter(c => c.catalog).flatMap(c => [c.slug, c.alt].filter(s => s && hasCatalog(nebulaDir, s)));
  const fpCat = out.floatplane.creators.filter(c => c.catalog).map(c => c.id);
  log(`index ${changed ? 'updated' : 'unchanged'}: Nebula ${Object.keys(out.nebula.videos).length} pre-matched videos, ${out.nebula.creators.length} creators, ${nebCat.length} catalogues (${count(nebulaDir, nebCat)} videos); Floatplane ${Object.keys(out.floatplane.videos).length} videos, ${out.floatplane.creators.length} creators, ${fpCat.length} catalogues (${count(fpDir, fpCat)} posts)`);
  return { changed, added: matched, data: out, nebNew, fpNew };
}

if (require.main === module) build().catch(e => { console.error(e); process.exit(1); });
module.exports = { build, parseYouTubeFeed };
