// Builds the master list the extension downloads from GitHub Pages
// (https://josh345rtfvqw.github.io/detour/data/...). Run daily by
// .github/workflows/update-list.yml, or by hand:  node scripts/build-known.js
//
// data/known.json (version 3) is keyed by YouTube, the anchor for every lookup:
//   videos     { "<YouTube video ID>":   { nebula: "<video slug>", floatplane: "<post id>" } }
//   channels   { "<YouTube channel ID>": { name, nebula: "<channel slug>", floatplane: "<creator id>[/<channel id>]" } }
//   nebula.creators      { "<slug>": { name, alt?, catalog } }            reference data
//   floatplane.creators  { "<creator id>": { name, urlname, channels: { "<id>": { name, urlname } }, catalog } }
// A platform column is absent when there's no match. catalog: true means a full catalogue file
// exists. IDs only, never URLs: the extension builds the links.
//
// Per-creator catalogues (every video, for matching videos not yet in `videos`):
//   data/nebula/<slug>.json      [{ s: slug, t: title, d: date }]
//   data/floatplane/<id>.json    [{ i: post id, t: title, d: date, c: channel id }]
// Catalogues are incremental: the first run pages back through each creator's whole history;
// later runs only fetch videos newer than what's stored.
//
// Matching is the same for both platforms: each creator's latest YouTube uploads (public RSS
// feed) are matched by title and date against their catalogue. Floatplane's YouTube links
// (@handles, /user/…) are resolved to channel IDs once and remembered in
// data/youtube-channels.json. Unresolvable links are logged and left out.
//
// Inputs edited by hand: data/floatplane-creators.json, data/overrides.json
//   overrides: { "videos": { "<YouTube video ID>": { "nebula": "<slug>" | null, "floatplane": "<post id>" | null } } }
//   A value sets that column; null removes a wrong match (keep the null, or it can come back).
//
// Everything is fetched anonymously: no logins, cookies or credentials, ever. If a source refuses,
// that part is skipped (logged once, not retried in a loop) and the previous data is kept. If
// Floatplane's creator list is refused, each creator's posts are still fetched using the IDs
// already known; if the posts endpoint refuses too, Floatplane is skipped for that run.
const fs = require('fs');
const path = require('path');
const { bestMatch, parseCreatorWall, decodeHtml, SLUG } = require('../match.js');
const { fpNameKey } = require('../floatplane-defaults.js');

const UA = 'DetourListBuilder/1.0 (+https://github.com/josh345rtfvqw/detour)';
const NEBULA_API = 'https://content.api.nebula.app';
const FP = 'https://www.floatplane.com';
const FP_ID = /^\w{1,64}$/;
const YT_VIDEO = /^[\w-]{11}$/;
const YT_CHANNEL = /^UC[\w-]{22}$/;
const MIN_CONFIDENCE = 0.85; // stricter than the extension: pre-matches are shared with every user
const MAX_VIDEOS = 100000;
const MAX_PAGES = 1000;      // safety stop per creator

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const sortObject = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const writeIfChanged = (file, data) => {
  const text = JSON.stringify(data) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return true;
};
const urlPath = u => { try { return new URL(u).pathname; } catch { return ''; } };
const nebulaSlugFromUrl = u => (urlPath(u).match(/^\/videos\/([\w-]+)\/?$/) || [])[1] || null;
const fpPostFromUrl = u => (urlPath(u).match(/^\/post\/(\w+)\/?$/) || [])[1] || null;

// YouTube's public per-channel feed: the latest ~15 uploads.
function parseYouTubeFeed(xml) {
  return xml.split('<entry>').slice(1).map(e => ({
    videoId: (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1],
    title: decodeHtml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(),
    date: (e.match(/<published>([^<]+)<\/published>/) || [])[1],
  })).filter(v => v.videoId && v.title);
}

// A YouTube link as a lookup key: "channel:UC…" needs no request; anything else ("@handle",
// "user:name", "c:name", "name") has to be resolved from the channel page.
function youtubeLinkKey(link) {
  let u; try { u = new URL(link); } catch { return null; }
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
  const p = u.pathname.split('/').filter(Boolean);
  if (!p.length) return null;
  if (p[0] === 'channel' && YT_CHANNEL.test(p[1] || '')) return `channel:${p[1]}`;
  if (p[0].startsWith('@')) return p[0].toLowerCase();
  if ((p[0] === 'user' || p[0] === 'c') && p[1]) return `${p[0]}:${p[1].toLowerCase()}`;
  return /^[\w.-]+$/.test(p[0]) ? `c:${p[0].toLowerCase()}` : null;
}
const youtubeKeyUrl = k => (k.startsWith('@') ? `https://www.youtube.com/${k}` : `https://www.youtube.com/${k.replace(':', '/')}`);
const channelIdFromPage = html => (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || html.match(/"externalId":"(UC[\w-]{22})"/) || [])[1] || null;

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}

// ------------------------------------------------------------------ catalogues

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

// ------------------------------------------------------------------ Floatplane creators

// Hand-edited list, filled in and extended with Floatplane's own creator list. If Floatplane
// refuses, the previous run's list (with IDs already filled in) is kept.
async function buildFloatplaneCreators({ get, log, handCreators, previousCreators }) {
  const links = o => Object.values(o || {}).filter(l => typeof l === 'string');
  const creators = handCreators.map(c => ({ ...c, links: [...(c.links || [])], channels: [...(c.channels || [])] }));
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
      existing.id = entry.id; existing.urlname = entry.urlname || existing.urlname;
      existing.links = [...new Set([...existing.links, ...entry.links])];
      for (const ch of entry.channels) {
        const ec = existing.channels.find(x => x.id === ch.id);
        if (!ec) existing.channels.push(ch);
        else { ec.urlname = ch.urlname || ec.urlname; ec.links = [...new Set([...(ec.links || []), ...ch.links])]; }
      }
    }
    log(`floatplane creator list: ${live.length} creators`);
    return { creators, refused: false };
  } catch (e) {
    const refused = /^40[13] /.test(e.message);
    log(`floatplane creator list failed: ${e.message}${refused ? ' (refused: login or bot protection, see the "refused by" line)' : ''}`);
    if (previousCreators.length) {
      const kept = previousCreators.map(c => ({ ...c, links: [...(c.links || [])], channels: [...(c.channels || [])] }));
      for (const h of creators) if (!kept.some(k => (h.id && k.id === h.id) || fpNameKey(k.title) === fpNameKey(h.title))) kept.push(h);
      return { creators: kept, refused };
    }
    return { creators, refused };
  }
}

// ------------------------------------------------------------------ previous data

// The previous index, read in any version, as { videos: { yt: { nebula, floatplane } },
// fpCreators: [...] (with links / channels, for when Floatplane refuses) }.
function readPrevious(previous) {
  const videos = {};
  const add = (id, col, val) => { if (YT_VIDEO.test(id) && val) (videos[id] ||= {})[col] = val; };
  if (previous.version === 3) {
    for (const [id, row] of Object.entries(previous.videos || {})) { add(id, 'nebula', row.nebula); add(id, 'floatplane', row.floatplane); }
  } else {
    const neb = previous.version === 2 ? previous.nebula?.videos : previous.nebula;
    const fp = previous.version === 2 ? previous.floatplane?.videos : previous.floatplane;
    for (const [id, url] of Object.entries(neb || {})) add(id, 'nebula', typeof url === 'string' && nebulaSlugFromUrl(url));
    for (const [id, url] of Object.entries(fp || {})) add(id, 'floatplane', typeof url === 'string' && fpPostFromUrl(url));
  }
  return { videos, fpCreators: previous._fpCreators || [] };
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
      // Anonymous requests only: no cookies or credentials are ever sent.
      const headers = { 'User-Agent': UA, 'Accept': type === 'json' ? 'application/json' : '*/*' };
      try { res = await fetchFn(url, { headers }); }
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
  const previousRaw = readJson(knownFile, {});
  const prev = readPrevious(previousRaw);
  const videos = prev.videos;
  const overrides = readJson(path.join(dataDir, 'overrides.json'), {});
  const handCreators = readJson(path.join(dataDir, 'floatplane-creators.json'), []);
  const handlesFile = path.join(dataDir, 'youtube-channels.json');
  const handles = readJson(handlesFile, {});           // "@handle" / "user:x" / "c:x" -> UC id
  const nebulaDir = path.join(dataDir, 'nebula');
  const fpDir = path.join(dataDir, 'floatplane');
  const channels = {};                                  // UC id -> { name, nebula, floatplane }
  const setChannel = (uc, name, col, val) => {
    if (!YT_CHANNEL.test(uc || '')) return;
    const row = (channels[uc] ||= { name });
    if (!row[col]) row[col] = val;
  };
  // Pre-match a YouTube channel's latest uploads against a catalogue.
  let matched = { nebula: 0, floatplane: 0 };
  const preMatch = async (uc, col, cands) => {
    if (!cands.length) return;
    try {
      const feed = parseYouTubeFeed(await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${uc}`, 'text'));
      for (const v of feed.filter(v => !videos[v.videoId]?.[col])) {
        const m = bestMatch(v.title, v.date, cands);
        if (m && m.confidence >= MIN_CONFIDENCE) { (videos[v.videoId] ||= {})[col] = m.id; matched[col]++; }
      }
    } catch (e) { /* feed unavailable today */ }
  };

  // 1. Nebula: creators, full catalogues, YouTube channels, pre-matches.
  let nebCreators = [];
  try {
    nebCreators = parseCreatorWall(await get('https://talent.nebula.tv/creators/', 'text'));
    log(`creator wall: ${nebCreators.length} creators (${nebCreators.filter(c => c.ytId).length} with a YouTube channel)`);
  } catch (e) { log(`creator wall failed: ${e.message}`); }
  if (!nebCreators.length && previousRaw.version === 3) {
    // Keep yesterday's creators if the wall couldn't be read.
    const prevByCreator = {};
    for (const [uc, row] of Object.entries(previousRaw.channels || {})) if (row.nebula) prevByCreator[row.nebula] = uc;
    nebCreators = Object.entries(previousRaw.nebula?.creators || {}).map(([slug, c]) => ({ name: c.name, slug, alt: c.alt || null, ytId: prevByCreator[slug] || null }));
  }

  let nebNew = 0, nebFailed = 0;
  const nebCatalog = {};
  await mapLimit(nebCreators, 2, async c => {
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
    nebCatalog[c.slug] = episodes.length > 0;
    if (c.ytId) {
      setChannel(c.ytId, c.name, 'nebula', c.slug);
      await preMatch(c.ytId, 'nebula', episodes.map(e => ({ title: e.t, date: e.d, id: e.s })));
    }
    if (delayMs) await sleep(delayMs);
  });
  log(`nebula: ${nebNew} new catalogue videos (${nebFailed} channels failed), ${matched.nebula} new pre-matched videos`);

  // 2. Floatplane: creators (live list, else hand-edited / previous IDs), then each creator's
  //    newest posts. A refused creator list doesn't stop the post fetches; a refused post fetch
  //    does (no point asking again for every creator).
  const { creators: fpCreators } = await buildFloatplaneCreators({ get, log, handCreators, previousCreators: prev.fpCreators });
  let fpNew = 0, fpFailed = 0, postsRefused = false;
  const fpCatalog = {};
  for (const c of fpCreators) if (FP_ID.test(c.id || '')) fpCatalog[c.id] = readJson(path.join(fpDir, `${c.id}.json`), []);
  await mapLimit(fpCreators.filter(c => FP_ID.test(c.id || '')), 1, async c => {
    if (postsRefused) return;
    const file = path.join(fpDir, `${c.id}.json`);
    try {
      const updated = await updateFloatplaneCatalog({ get, sleep, delayMs, id: c.id, existing: fpCatalog[c.id] });
      fpNew += updated.length - fpCatalog[c.id].length;
      writeIfChanged(file, updated);
      fpCatalog[c.id] = updated;
    } catch (e) {
      fpFailed++;
      if (/^40[13] /.test(e.message)) postsRefused = true;
    }
  });
  log(postsRefused
    ? 'floatplane posts: refused (see the "refused by" line); previous catalogues kept'
    : `floatplane: ${fpNew} new catalogue posts from ${Object.keys(fpCatalog).length} creators (${fpFailed} failed)`);

  // 3. Floatplane YouTube links -> channel IDs (resolved once, remembered), then pre-matches.
  let resolvedNew = 0, unresolved = [];
  const resolve = async link => {
    const key = youtubeLinkKey(link);
    if (!key) return null;
    if (key.startsWith('channel:')) return key.slice(8);
    if (handles[key]) return handles[key];
    try {
      const uc = channelIdFromPage(await get(youtubeKeyUrl(key), 'text'));
      if (uc) { handles[key] = uc; resolvedNew++; return uc; }
    } catch (e) { /* try again next run */ }
    unresolved.push(key);
    return null;
  };
  for (const c of fpCreators.filter(c => FP_ID.test(c.id || ''))) {
    const posts = fpCatalog[c.id] || [];
    const targets = [
      ...(c.channels || []).filter(ch => FP_ID.test(ch.id || '')).map(ch => ({ name: ch.title || c.title, value: `${c.id}/${ch.id}`, links: ch.links || [], posts: posts.filter(p => !p.c || p.c === ch.id) })),
      { name: c.title, value: c.id, links: c.links || [], posts },
    ];
    for (const t of targets) {
      for (const link of t.links.filter(l => /youtube\.com/.test(l))) {
        const uc = await resolve(link);
        if (!uc) continue;
        const before = channels[uc]?.floatplane;
        setChannel(uc, t.name, 'floatplane', t.value);
        if (!before && channels[uc].floatplane === t.value) await preMatch(uc, 'floatplane', t.posts.map(p => ({ title: p.t, date: p.d, id: p.i })));
      }
    }
  }
  writeIfChanged(handlesFile, sortObject(handles));
  log(`youtube channels: ${Object.keys(handles).length} resolved links (${resolvedNew} new)${unresolved.length ? `, unresolved: ${[...new Set(unresolved)].join(', ')}` : ''}; floatplane: ${matched.floatplane} new pre-matched videos`);

  // 4. Manual overrides win.
  for (const [id, row] of Object.entries(overrides.videos || {})) {
    if (!YT_VIDEO.test(id) || !row || typeof row !== 'object') continue;
    for (const [col, valid] of [['nebula', SLUG], ['floatplane', FP_ID]]) {
      if (!(col in row)) continue;
      if (row[col] === null) { if (videos[id]) delete videos[id][col]; }
      else if (typeof row[col] === 'string' && valid.test(row[col])) (videos[id] ||= {})[col] = row[col];
    }
    if (videos[id] && !Object.keys(videos[id]).length) delete videos[id];
  }

  // 5. The index.
  const videoEntries = Object.entries(videos).filter(([, r]) => r.nebula || r.floatplane);
  const nebulaIndex = {};
  for (const c of nebCreators) nebulaIndex[c.slug] = { name: c.name, ...(c.alt && c.alt !== c.slug ? { alt: c.alt } : {}), catalog: !!nebCatalog[c.slug] };
  const fpIndex = {};
  for (const c of fpCreators.filter(c => FP_ID.test(c.id || ''))) {
    const chs = {};
    for (const ch of (c.channels || []).filter(ch => FP_ID.test(ch.id || ''))) chs[ch.id] = { name: ch.title, urlname: ch.urlname || null };
    fpIndex[c.id] = { name: c.title, urlname: c.urlname || null, channels: chs, catalog: (fpCatalog[c.id] || []).length > 0 };
  }
  const data = {
    version: 3,
    videos: sortObject(Object.fromEntries(videoEntries.slice(Math.max(0, videoEntries.length - MAX_VIDEOS)))),
    channels: sortObject(channels),
    nebula: { creators: sortObject(nebulaIndex) },
    floatplane: { creators: sortObject(fpIndex) },
    // Kept so a run where Floatplane refuses still knows each creator's YouTube links and channels.
    _fpCreators: fpCreators.map(({ catalog, ...c }) => c),
  };
  // Only bump "generated" when the index changes, so quiet days don't rewrite it.
  const { generated: _g, ...prevContent } = previousRaw;
  const changed = JSON.stringify(prevContent) !== JSON.stringify(data);
  const out = { version: 3, generated: changed ? now.toISOString() : (previousRaw.generated || now.toISOString()), ...data };
  writeIfChanged(knownFile, out);
  if (Object.keys(failures).length) log(`request failures (after retries): ${JSON.stringify(failures)}`);
  const vcount = col => Object.values(out.videos).filter(r => r[col]).length;
  log(`index ${changed ? 'updated' : 'unchanged'}: ${Object.keys(out.videos).length} videos (${vcount('nebula')} Nebula, ${vcount('floatplane')} Floatplane), ${Object.keys(out.channels).length} channels; catalogues: ${Object.values(nebulaIndex).filter(c => c.catalog).length} Nebula, ${Object.values(fpIndex).filter(c => c.catalog).length} Floatplane`);
  return { changed, data: out, nebNew, fpNew, matched };
}

if (require.main === module) build().catch(e => { console.error(e); process.exit(1); });
module.exports = { build, parseYouTubeFeed, youtubeLinkKey, channelIdFromPage };
