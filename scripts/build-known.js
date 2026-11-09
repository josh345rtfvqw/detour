// Builds the master list the extension downloads from GitHub Pages
// (https://josh345rtfvqw.github.io/detour/data/...). Run daily by
// .github/workflows/update-list.yml, or by hand:  node scripts/build-known.js
//
// data/known.json (version 3) is keyed by YouTube, the anchor for every lookup:
//   counts     totals for checking at a glance (videos, creators, channels); not used by the extension
//   videos     { "<YouTube video ID>":   { nebula: "<video slug>" | "<podcast>/<episode>", floatplane: "<post id>" } }
//   channels   { "<YouTube channel ID>": { name, nebula: "<channel slug>", floatplane: "<creator id>[/<channel id>]" } }
//   nebula.creators      { "<slug>": { name, alt?, catalog } }            reference data
//   nebula.podcasts      { "<podcast slug>": { name, catalog } }
//   floatplane.creators  { "<creator id>": { name, urlname, channels: { "<id>": { name, urlname } }, catalog } }
// A platform column is absent when there's no match. catalog: true means a full catalogue file
// exists. IDs only, never URLs: the extension builds the links.
//
// Per-creator catalogues (every video, for matching videos not yet in `videos`):
//   data/nebula/<slug>.json      [{ s: slug, t: title, d: date }]
//   data/nebula-podcasts/<slug>.json  [{ s: episode slug, t: title, d: date }]
//   data/floatplane/<id>.json    [{ i: post id, t: title, d: date, c: channel id }]
// Catalogues are incremental: the first run pages back through each creator's whole history;
// later runs only fetch videos newer than what's stored.
//
// Nebula channels come from Nebula's channel list (behind nebula.tv/explore/channels) plus its
// newest-channels feed; podcasts from its podcast list. The creator wall links channels to
// YouTube; channels not on it are linked by a same-named YouTube handle whose channel name
// matches (remembered as "guess:<slug>" in data/youtube-channels.json), or by overrides.json.
//
// Matching is the same for both platforms: each creator's latest YouTube uploads (public RSS
// feed) are matched by title and date against their catalogue. A backfill run (BACKFILL=1 with
// YOUTUBE_API_KEY set) instead pages through each channel's whole upload list with the YouTube
// Data API (playlistItems, 1 quota unit per 50 videos), so older videos get matched too. Floatplane's YouTube links
// (@handles, /user/…) are resolved to channel IDs once and remembered in
// data/youtube-channels.json. Unresolvable links are logged and left out.
//
// Inputs edited by hand: data/floatplane-creators.json, data/overrides.json, data/nebula-podcasts.json
//   nebula-podcasts: { "<podcast slug>": { "creators"?: ["<creator wall slug>"], "youtube"?: ["<YouTube channel link>"] } }
//   A podcast is linked to its creator's YouTube channel by name; list "creators" or "youtube"
//   when the name doesn't match the creator wall.
//   overrides: { "videos": { "<YouTube video ID>": { "nebula": "<slug>" | null, "floatplane": "<post id>" | null } } }
//   A value sets that column; null removes a wrong match (keep the null, or it can come back).
//   overrides also takes "channels": { "<nebula slug>": "<YouTube channel link>" }.
//
// Everything is fetched anonymously: no logins, cookies or credentials, ever. The one exception is
// the optional YouTube Data API key for backfill runs, sent only to www.googleapis.com in a header. If a source refuses,
// that part is skipped (logged once, not retried in a loop) and the previous data is kept. If
// Floatplane's creator list is refused, each creator's posts are still fetched using the IDs
// already known; if the posts endpoint refuses too, Floatplane is skipped for that run.
const fs = require('fs');
const path = require('path');
const { bestMatch, tokens, parseCreatorWall, decodeHtml, normalizeName, SLUG } = require('../match.js');
const { fpNameKey } = require('../floatplane-defaults.js');

const UA = 'DetourListBuilder/1.0 (+https://github.com/josh345rtfvqw/detour)';
const NEBULA_API = 'https://content.api.nebula.app';
const FP = 'https://www.floatplane.com';
const FP_ID = /^\w{1,64}$/;
const YT_VIDEO = /^[\w-]{11}$/;
const YT_CHANNEL = /^UC[\w-]{22}$/;
const NEBULA_PODCAST_EPISODE = /^[\w-]{1,100}\/[\w-]{1,100}$/; // "<show>/<episode>"
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
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

// Index candidates by title token, so matching a YouTube title only scores candidates that share
// a word with it. Others score 0 anyway, so results are identical, just much faster for creators
// with thousands of videos on both sides.
function indexCandidates(cands) {
  const byToken = new Map();
  cands.forEach((c, i) => { for (const t of new Set(tokens(c.title))) { if (!byToken.has(t)) byToken.set(t, []); byToken.get(t).push(i); } });
  return title => {
    const hit = new Set();
    for (const t of new Set(tokens(title))) for (const i of byToken.get(t) || []) hit.add(i);
    return [...hit].map(i => cands[i]);
  };
}

// A channel's whole upload list from the YouTube Data API ("UU…" uploads playlist).
async function fetchAllUploads({ get, uc, apiKey }) {
  const out = [];
  let pageToken = '', pages = 0;
  do {
    const q = new URLSearchParams({ part: 'snippet,contentDetails', maxResults: '50', playlistId: 'UU' + uc.slice(2) });
    if (pageToken) q.set('pageToken', pageToken);
    const res = await get(`https://www.googleapis.com/youtube/v3/playlistItems?${q}`, 'json', { 'X-Goog-Api-Key': apiKey });
    pages++;
    for (const it of res.items || []) {
      const videoId = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
      const title = String(it.snippet?.title || '').trim();
      if (YT_VIDEO.test(videoId || '') && title && title !== 'Private video' && title !== 'Deleted video') {
        out.push({ videoId, title, date: it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt });
      }
    }
    pageToken = res.nextPageToken || '';
  } while (pageToken && pages < MAX_PAGES);
  return { videos: out, pages };
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

// Every Nebula video channel or podcast: the list behind nebula.tv/explore/channels.
async function listNebula({ get, sleep, delayMs, kind }) {
  const out = [];
  let url = `${NEBULA_API}/${kind}/?page_size=100`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const body = await get(url);
    if (!Array.isArray(body.results)) throw new Error('unexpected response');
    for (const c of body.results) {
      if (!SLUG.test(c.slug || '') || typeof c.title !== 'string') continue;
      out.push({ slug: c.slug, name: c.title, aliases: (Array.isArray(c.slug_aliases) ? c.slug_aliases : []).filter(s => typeof s === 'string' && SLUG.test(s)) });
    }
    url = body.next && body.next.startsWith(NEBULA_API) ? body.next : null;
    if (url && delayMs) await sleep(delayMs);
  }
  return out;
}

// Nebula's feed of its newest channels (rss.nebula.app/video/channels.rss).
function parseNebulaChannelsFeed(xml) {
  return xml.split('<item>').slice(1).map(it => ({
    slug: (it.match(/<link>https:\/\/nebula\.tv\/([\w-]+)\/?<\/link>/) || [])[1],
    name: decodeHtml((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim(),
  })).filter(c => c.slug && SLUG.test(c.slug) && c.name).map(c => ({ ...c, aliases: [] }));
}

// Newest-first pages of a Nebula podcast's episodes, stopping at the first one stored. Podcasts
// are a different content type ("podcast_channel") with their own episodes endpoint, and their
// episodes live at nebula.tv/<show>/<episode>/ rather than nebula.tv/videos/<slug>.
async function updateNebulaPodcast({ get, sleep, delayMs, slug, existing }) {
  const show = await get(`${NEBULA_API}/content/${slug}/`);
  if (show.type !== 'podcast_channel' || typeof show.id !== 'string') throw new Error(`not a podcast: ${slug}`);
  const known = new Set(existing.map(e => e.s));
  let url = `${NEBULA_API}/podcast_channels/${encodeURIComponent(show.id)}/podcast_episodes/?page_size=100`;
  const fresh = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const body = await get(url);
    let reachedKnown = false;
    for (const v of body.results || []) {
      const fromUrl = (urlPath(v.share_url || '').match(/^\/[\w-]+\/([\w-]+)\/?$/) || [])[1];
      const s = fromUrl || (SLUG.test(v.slug || '') ? v.slug : null);
      if (!s || typeof v.title !== 'string') continue;
      if (known.has(s)) { reachedKnown = true; break; }
      fresh.push({ s, t: v.title, d: (v.published_at || '').slice(0, 10) });
      known.add(s);
    }
    if (reachedKnown) break;
    url = body.next && body.next.startsWith(NEBULA_API) ? body.next : null;
    if (url && delayMs) await sleep(delayMs);
  }
  return { title: typeof show.title === 'string' ? show.title : slug, creator: typeof show.creator === 'string' ? show.creator : '', episodes: [...fresh, ...existing] };
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

// Merges one Floatplane creator object (from creator/list or creator/named) into `creators`:
// live data fills in IDs, addresses, YouTube links and sub-channels; hand-entered links are kept.
// `match` optionally finds the existing entry (e.g. by the lowercase address that was asked for).
function mergeFloatplaneCreator(creators, lc, match) {
  const links = o => Object.values(o || {}).filter(l => typeof l === 'string');
  if (!lc || !FP_ID.test(lc.id || '') || typeof lc.title !== 'string') return false;
  const entry = {
    id: lc.id, title: lc.title, urlname: lc.urlname || null, links: links(lc.socialLinks),
    channels: (lc.channels || []).filter(ch => ch && FP_ID.test(ch.id || '')).map(ch => ({ id: ch.id, title: ch.title, urlname: ch.urlname || null, links: links(ch.socialLinks) })),
  };
  const existing = creators.find(c => c.id === lc.id) || (match && creators.find(match)) || creators.find(c => fpNameKey(c.title) === fpNameKey(lc.title));
  if (!existing) { creators.push(entry); return true; }
  existing.id = entry.id; existing.urlname = entry.urlname || existing.urlname;
  existing.links = [...new Set([...(existing.links || []), ...entry.links])];
  existing.channels = existing.channels || [];
  for (const ch of entry.channels) {
    const ec = existing.channels.find(x => x.id === ch.id);
    if (!ec) existing.channels.push(ch);
    else { ec.urlname = ch.urlname || ec.urlname; ec.links = [...new Set([...(ec.links || []), ...ch.links])]; }
  }
  return true;
}

// A creator's Floatplane web address name. creator/named matches it exactly (case-sensitive), so a
// stored urlname is used as written ("TylerMcVicker"); without one, the usual form of the display
// name is guessed (lowercase letters and digits, e.g. "Level1Techs" -> "level1techs").
const floatplaneUrlname = c => (c.urlname ? String(c.urlname) : String(c.title || '').toLowerCase().replace(/[^a-z0-9]/g, ''));

// Creators: the hand-edited list (just id, title, urlname) plus any from the previous index, then
// filled in each run by Floatplane itself: creator/list if it answers, and creator/named by
// address (several per request). YouTube links and sub-channels come from those lookups and are
// never stored by hand.
async function buildFloatplaneCreators({ get, log, handCreators, previousIndex }) {
  const creators = handCreators.map(c => ({ id: c.id || null, title: c.title, urlname: c.urlname || null, links: [], channels: [] }));
  for (const [id, pc] of Object.entries(previousIndex || {})) {
    if (!FP_ID.test(id) || creators.some(c => c.id === id)) continue;
    creators.push({ id, title: pc.name, urlname: pc.urlname || null, links: [],
      channels: Object.entries(pc.channels || {}).map(([chId, ch]) => ({ id: chId, title: ch.name, urlname: ch.urlname || null, links: [] })) });
  }
  let refused = false;
  try {
    const live = await get(`${FP}/api/v3/creator/list?search=`);
    if (!Array.isArray(live)) throw new Error('unexpected response');
    for (const lc of live) mergeFloatplaneCreator(creators, lc);
    log(`floatplane creator list: ${live.length} creators`);
  } catch (e) {
    refused = /^40[13] /.test(e.message);
    log(`floatplane creator list failed: ${e.message}${refused ? ' (refused: login or bot protection, see the "refused by" line)' : ''}`);
  }

  // creator/named: look up every creator by its exact address, 10 per request.
  const names = [...new Set(creators.map(floatplaneUrlname).filter(n => /^[A-Za-z0-9_]{1,64}$/.test(n)))];
  const found = new Set();
  for (let i = 0; i < names.length; i += 10) {
    const batch = names.slice(i, i + 10);
    const q = batch.map((n, j) => `creatorURL[${j}]=${encodeURIComponent(n)}`).join('&');
    try {
      const res = await get(`${FP}/api/v3/creator/named?${q}`);
      for (const lc of Array.isArray(res) ? res : []) {
        const got = String(lc?.urlname || '').toLowerCase();
        if (mergeFloatplaneCreator(creators, lc, c => floatplaneUrlname(c).toLowerCase() === got)) found.add(got);
      }
    } catch (e) {
      log(`floatplane creator/named failed: ${e.message}`);
      if (/^40[13] /.test(e.message)) break; // refused: don't ask again for every batch
    }
  }
  const missing = names.filter(n => !found.has(n.toLowerCase()));
  log(`floatplane creator/named: ${found.size} of ${names.length} creators found${missing.length ? `; no creator at: ${missing.join(', ')} (set "urlname" in data/floatplane-creators.json)` : ''}`);
  return { creators, refused };
}

// ------------------------------------------------------------------ previous data

// The previous index, read in any version, as { videos: { yt: { nebula, floatplane } } }.
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
  return { videos };
}

// ------------------------------------------------------------------ build

async function build({ fetchFn = fetch, dataDir = path.join(__dirname, '..', 'data'), now = new Date(), log = console.log, delayMs = 400, retryBaseMs = 2000,
  backfill = process.env.BACKFILL === '1' || process.env.BACKFILL === 'true', youtubeApiKey = process.env.YOUTUBE_API_KEY || '' } = {}) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const failures = {};          // "host status" -> count, for the log
  const refusalsLogged = new Set();
  // GET with polite retries: on 429 (rate limited) or 5xx, wait (Retry-After if given, else
  // exponential back-off) and try again, up to 4 times. Refusals are logged once per host.
  const get = async (url, type = 'json', extraHeaders = {}) => {
    const host = (() => { try { return new URL(url).hostname; } catch { return '?'; } })();
    for (let attempt = 0; ; attempt++) {
      let res;
      // Anonymous requests only: no cookies or credentials are ever sent.
      const headers = { 'User-Agent': UA, 'Accept': type === 'json' ? 'application/json' : '*/*', ...extraHeaders };
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
  const nebulaPodcastDir = path.join(dataDir, 'nebula-podcasts');
  const fpDir = path.join(dataDir, 'floatplane');
  const channels = {};                                  // UC id -> { name, nebula, floatplane }
  const setChannel = (uc, name, col, val) => {
    if (!YT_CHANNEL.test(uc || '')) return;
    const row = (channels[uc] ||= { name });
    if (!row[col]) row[col] = val;
  };
  // Pre-match a YouTube channel's uploads against a catalogue: the latest ~15 from the RSS feed,
  // or on a backfill run the whole upload list (each channel fetched once per run).
  let matched = { nebula: 0, floatplane: 0 };
  const useApi = backfill && !!youtubeApiKey;
  if (backfill && !youtubeApiKey) log('backfill requested but YOUTUBE_API_KEY is not set: using RSS feeds (latest uploads only)');
  const yt = { calls: 0, videos: 0, channels: 0, stopped: '' };
  const uploadsCache = new Map();
  const uploadsOf = async uc => {
    if (useApi && !yt.stopped) {
      if (!uploadsCache.has(uc)) {
        uploadsCache.set(uc, (async () => {
          try {
            const r = await fetchAllUploads({ get, uc, apiKey: youtubeApiKey });
            yt.calls += r.pages; yt.videos += r.videos.length; yt.channels++;
            return r.videos;
          } catch (e) {
            if (/^403 /.test(e.message)) yt.stopped = 'refused (quota used up or key not allowed)';
            return null;
          }
        })());
      }
      const all = await uploadsCache.get(uc);
      if (all) return all;
    }
    return parseYouTubeFeed(await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${uc}`, 'text'));
  };
  const preMatch = async (uc, col, cands) => {
    if (!cands.length) return;
    try {
      const uploads = await uploadsOf(uc);
      const near = indexCandidates(cands);
      for (const v of uploads.filter(v => !videos[v.videoId]?.[col])) {
        const m = bestMatch(v.title, v.date, near(v.title));
        if (m && m.confidence >= MIN_CONFIDENCE) { (videos[v.videoId] ||= {})[col] = m.id; matched[col]++; }
      }
    } catch (e) { /* feed unavailable today */ }
  };

  // 1. Nebula channels: every channel from Nebula's channel list (the one behind
  //    nebula.tv/explore/channels), plus its newest-channels feed so a new channel is picked up
  //    even if the list fails. The creator wall supplies YouTube channel IDs; channels not on the
  //    wall are linked to YouTube in step 3a. Then full catalogues and pre-matches.
  const prevByCreator = {};
  for (const [uc, row] of Object.entries(previousRaw.channels || {})) if (typeof row?.nebula === 'string') prevByCreator[row.nebula] = uc;
  const nebChannels = new Map();                        // slug -> { slug, name, aliases, ytId }
  const addChannel = c => { if (!nebChannels.has(c.slug)) nebChannels.set(c.slug, { slug: c.slug, name: c.name, aliases: c.aliases || [], ytId: null }); };
  let listOk = false;
  try {
    (await listNebula({ get, sleep, delayMs, kind: 'video_channels' })).forEach(addChannel);
    listOk = nebChannels.size > 0;
  } catch (e) { log(`nebula channel list failed: ${e.message}`); }
  let feedNew = [];
  try {
    const fromFeed = parseNebulaChannelsFeed(await get('https://rss.nebula.app/video/channels.rss', 'text'));
    feedNew = fromFeed.filter(c => !nebChannels.has(c.slug)).map(c => c.slug);
    fromFeed.forEach(addChannel);
  } catch (e) { log(`nebula channels feed failed: ${e.message}`); }
  if (!listOk && previousRaw.version === 3) {
    // Keep yesterday's channels if the list couldn't be read.
    for (const [slug, c] of Object.entries(previousRaw.nebula?.creators || {})) if (SLUG.test(slug) && typeof c?.name === 'string') addChannel({ slug, name: c.name });
  }
  let wall = [];
  try { wall = parseCreatorWall(await get('https://talent.nebula.tv/creators/', 'text')); }
  catch (e) { log(`creator wall failed: ${e.message}`); }
  // A wall card links a YouTube channel to a Nebula channel (its link, or its talent page slug).
  const bySlugOrAlias = new Map();
  for (const c of nebChannels.values()) for (const s of [c.slug, ...c.aliases]) if (!bySlugOrAlias.has(s)) bySlugOrAlias.set(s, c);
  let wallLinked = 0;
  for (const w of wall) {
    let c = [w.slug, w.alt].map(s => bySlugOrAlias.get(s)).find(Boolean);
    if (!c && !listOk) { addChannel({ slug: w.slug, name: w.name }); c = nebChannels.get(w.slug); }
    if (c && w.ytId && !c.ytId) { c.ytId = w.ytId; wallLinked++; }
  }
  for (const c of nebChannels.values()) if (!c.ytId && YT_CHANNEL.test(prevByCreator[c.slug] || '') && !wall.length) c.ytId = prevByCreator[c.slug];
  log(`nebula channels: ${nebChannels.size}${listOk ? '' : ' (channel list unavailable)'}${feedNew.length ? `, new in the channels feed: ${feedNew.join(', ')}` : ''}; creator wall: ${wall.length} cards, ${wallLinked} linked to YouTube`);
  const nebCreators = [...nebChannels.values()];

  let nebNew = 0, nebFailed = 0;
  const nebCatalog = {};                                // slug -> catalogue entries
  await mapLimit(nebCreators, 2, async c => {
    const file = path.join(nebulaDir, `${c.slug}.json`);
    const existing = readJson(file, []);
    try {
      const updated = await updateNebulaCatalog({ get, sleep, delayMs, slug: c.slug, existing });
      nebNew += updated.length - existing.length;
      writeIfChanged(file, updated);
      nebCatalog[c.slug] = updated;
    } catch (e) { nebFailed++; nebCatalog[c.slug] = existing; }
    if (c.ytId) {
      setChannel(c.ytId, c.name, 'nebula', c.slug);
      await preMatch(c.ytId, 'nebula', nebCatalog[c.slug].map(e => ({ title: e.t, date: e.d, id: e.s })));
    }
    if (delayMs) await sleep(delayMs);
  });
  log(`nebula: ${nebNew} new catalogue videos (${nebFailed} channels failed), ${matched.nebula} new pre-matched videos`);

  // 2. Floatplane: creators (live list, else hand-edited / previous IDs), then each creator's
  //    newest posts. A refused creator list doesn't stop the post fetches; a refused post fetch
  //    does (no point asking again for every creator).
  const { creators: fpCreators } = await buildFloatplaneCreators({ get, log, handCreators, previousIndex: previousRaw.version === 3 ? previousRaw.floatplane?.creators : null });
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
  // A creator whose details couldn't be looked up this run (no YouTube links): keep its rows
  // from the previous index rather than dropping them.
  const looked = new Set(fpCreators.filter(c => [...(c.links || []), ...(c.channels || []).flatMap(ch => ch.links || [])].length).map(c => c.id));
  if (previousRaw.version === 3) {
    for (const [uc, row] of Object.entries(previousRaw.channels || {})) {
      const fpVal = typeof row?.floatplane === 'string' ? row.floatplane : '';
      if (fpVal && !looked.has(fpVal.split('/')[0]) && !channels[uc]?.floatplane) setChannel(uc, row.name, 'floatplane', fpVal);
    }
  }
  writeIfChanged(handlesFile, sortObject(handles));
  log(`youtube channels: ${Object.keys(handles).length} resolved links (${resolvedNew} new)${unresolved.length ? `, unresolved: ${[...new Set(unresolved)].join(', ')}` : ''}; floatplane: ${matched.floatplane} new pre-matched videos`);

  // 3a. Nebula channels the creator wall doesn't link to YouTube: a link set in
  //     overrides.json ("channels": { "<nebula slug>": "<YouTube channel link>" }), else the
  //     YouTube handle with the same name as the slug, accepted only if that YouTube channel's
  //     name matches the Nebula channel's. Guesses are remembered either way ("guess:<slug>" in
  //     data/youtube-channels.json, "" for no match; delete the entry to try again).
  const ytName = html => decodeHtml((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '').trim();
  const taken = new Set(Object.keys(channels).filter(uc => channels[uc].nebula));
  let guessed = 0, guessedNew = 0;
  for (const c of nebCreators.filter(c => !c.ytId)) {
    const link = isObj(overrides.channels) && typeof overrides.channels[c.slug] === 'string' ? overrides.channels[c.slug] : null;
    let uc = link ? await resolve(link) : null;
    if (!uc) {
      const key = `guess:${c.slug}`;
      if (!(key in handles)) {
        handles[key] = '';
        try {
          const html = await get(`https://www.youtube.com/@${c.slug}`, 'text');
          const found = channelIdFromPage(html);
          if (found && normalizeName(ytName(html)) === normalizeName(c.name)) { handles[key] = found; guessedNew++; }
        } catch (e) { if (!/^404 /.test(e.message)) delete handles[key]; /* not a definite miss: try again next run */ }
        if (delayMs) await sleep(delayMs);
      }
      uc = handles[key] || null;
    }
    if (!uc || taken.has(uc)) continue;
    c.ytId = uc; taken.add(uc); guessed++;
    setChannel(uc, c.name, 'nebula', c.slug);
    await preMatch(uc, 'nebula', (nebCatalog[c.slug] || []).map(e => ({ title: e.t, date: e.d, id: e.s })));
  }
  writeIfChanged(handlesFile, sortObject(handles));
  log(`nebula channels not on the creator wall: ${guessed} linked to YouTube (${guessedNew} new), ${nebCreators.filter(c => !c.ytId).length} without a YouTube channel`);

  // 3b. Nebula podcasts: every show in Nebula's podcast list, plus any listed in
  //     data/nebula-podcasts.json (which also holds per-show settings). Each show is linked to YouTube through its creator's wall entry (by name, or the
  //     "creators" listed for it) plus any "youtube" links given. This runs after the video
  //     pre-matches, which skip uploads already matched, so a video match always wins.
  const podcastList = { ...readJson(path.join(dataDir, 'nebula-podcasts.json'), {}) };
  try {
    for (const p of await listNebula({ get, sleep, delayMs, kind: 'podcast_channels' })) if (!isObj(podcastList[p.slug])) podcastList[p.slug] = {};
  } catch (e) { log(`nebula podcast list failed: ${e.message}`); for (const s of Object.keys(previousRaw.nebula?.podcasts || {})) podcastList[s] ||= {}; }
  const wallByName = {}, wallBySlug = {};
  for (const c of nebCreators) {
    if (!c.ytId) continue;
    (wallByName[normalizeName(c.name)] ||= []).push(c.ytId);
    wallBySlug[c.slug] = c.ytId;
  }
  let podNew = 0, podFailed = 0;
  const podMatchedBefore = matched.nebula;
  const podcastIndex = {};
  await mapLimit(Object.entries(isObj(podcastList) ? podcastList : {}).filter(([s]) => SLUG.test(s)), 2, async ([slug, cfg]) => {
    cfg = isObj(cfg) ? cfg : {};
    const file = path.join(nebulaPodcastDir, `${slug}.json`);
    const existing = readJson(file, []);
    let show = { title: previousRaw.nebula?.podcasts?.[slug]?.name || slug, creator: '', episodes: existing };
    try {
      show = await updateNebulaPodcast({ get, sleep, delayMs, slug, existing });
      podNew += show.episodes.length - existing.length;
      writeIfChanged(file, show.episodes);
    } catch (e) { podFailed++; }
    const ucs = new Set();
    for (const part of show.creator.split(/\s*(?:&|,|\band\b)\s*/i)) for (const uc of wallByName[normalizeName(part)] || []) ucs.add(uc);
    for (const s of Array.isArray(cfg.creators) ? cfg.creators : []) if (wallBySlug[s]) ucs.add(wallBySlug[s]);
    for (const link of Array.isArray(cfg.youtube) ? cfg.youtube : []) { const uc = await resolve(String(link)); if (uc) ucs.add(uc); }
    podcastIndex[slug] = { name: show.title, catalog: show.episodes.length > 0 };
    const cands = show.episodes.map(e => ({ title: e.t, date: e.d, id: `${slug}/${e.s}` }));
    for (const uc of ucs) await preMatch(uc, 'nebula', cands);
    if (delayMs) await sleep(delayMs);
  });
  writeIfChanged(handlesFile, sortObject(handles));
  log(`nebula podcasts: ${Object.keys(podcastIndex).length} shows, ${podNew} new episodes (${podFailed} failed), ${matched.nebula - podMatchedBefore} new pre-matched videos`);

  if (useApi) log(`youtube backfill: ${yt.videos} uploads from ${yt.channels} channels in ${yt.calls} API requests${yt.stopped ? `; stopped early: ${yt.stopped}` : ''}`);

  // 4. Manual overrides win.
  for (const [id, row] of Object.entries(overrides.videos || {})) {
    if (!YT_VIDEO.test(id) || !row || typeof row !== 'object') continue;
    for (const [col, valid] of [['nebula', { test: v => SLUG.test(v) || NEBULA_PODCAST_EPISODE.test(v) }], ['floatplane', FP_ID]]) {
      if (!(col in row)) continue;
      if (row[col] === null) { if (videos[id]) delete videos[id][col]; }
      else if (typeof row[col] === 'string' && valid.test(row[col])) (videos[id] ||= {})[col] = row[col];
    }
    if (videos[id] && !Object.keys(videos[id]).length) delete videos[id];
  }

  // 5. The index.
  const videoEntries = Object.entries(videos).filter(([, r]) => r.nebula || r.floatplane);
  const nebulaIndex = {};
  for (const c of nebCreators) nebulaIndex[c.slug] = { name: c.name, catalog: (nebCatalog[c.slug] || []).length > 0 };
  const fpIndex = {};
  for (const c of fpCreators.filter(c => FP_ID.test(c.id || ''))) {
    const chs = {};
    for (const ch of (c.channels || []).filter(ch => FP_ID.test(ch.id || ''))) chs[ch.id] = { name: ch.title, urlname: ch.urlname || null };
    fpIndex[c.id] = { name: c.title, urlname: c.urlname || null, channels: chs, catalog: (fpCatalog[c.id] || []).length > 0 };
  }
  const keptVideos = Object.fromEntries(videoEntries.slice(Math.max(0, videoEntries.length - MAX_VIDEOS)));
  const rows = Object.values(keptVideos);
  // Totals, for checking the list at a glance. The extension ignores them.
  const counts = {
    videos: rows.length,
    nebula_videos: rows.filter(r => r.nebula && !NEBULA_PODCAST_EPISODE.test(r.nebula)).length,
    nebula_podcast_episodes: rows.filter(r => NEBULA_PODCAST_EPISODE.test(r.nebula || '')).length,
    floatplane_videos: rows.filter(r => r.floatplane).length,
    youtube_channels: Object.keys(channels).length,
    nebula_creators: Object.keys(nebulaIndex).length,
    nebula_creators_on_youtube: Object.values(channels).filter(c => c.nebula).length,
    nebula_podcasts: Object.keys(podcastIndex).length,
    floatplane_creators: Object.keys(fpIndex).length,
  };
  const data = {
    version: 3,
    counts,
    videos: sortObject(keptVideos),
    channels: sortObject(channels),
    nebula: { creators: sortObject(nebulaIndex), podcasts: sortObject(podcastIndex) },
    floatplane: { creators: sortObject(fpIndex) },
  };
  // Only bump "generated" when the index changes, so quiet days don't rewrite it.
  const { generated: _g, ...prevContent } = previousRaw;
  const changed = JSON.stringify(prevContent) !== JSON.stringify(data);
  const out = { version: 3, generated: changed ? now.toISOString() : (previousRaw.generated || now.toISOString()), ...data };
  writeIfChanged(knownFile, out);
  if (Object.keys(failures).length) log(`request failures (after retries): ${JSON.stringify(failures)}`);
  log(`index ${changed ? 'updated' : 'unchanged'}: ${counts.videos} videos (${counts.nebula_videos} Nebula videos, ${counts.nebula_podcast_episodes} Nebula podcast episodes, ${counts.floatplane_videos} Floatplane), ${counts.youtube_channels} channels; catalogues: ${Object.values(nebulaIndex).filter(c => c.catalog).length} Nebula, ${Object.values(fpIndex).filter(c => c.catalog).length} Floatplane`);
  return { changed, data: out, nebNew, fpNew, matched };
}

if (require.main === module) build().catch(e => { console.error(e); process.exit(1); });
module.exports = { build, parseYouTubeFeed, youtubeLinkKey, channelIdFromPage };
