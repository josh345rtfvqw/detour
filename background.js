// Background: looks up whether a YouTube video exists on Nebula / Floatplane.
// Chrome runs this as a service worker (needs importScripts); Firefox loads match.js first.
if (typeof importScripts === 'function' && typeof bestMatch === 'undefined') importScripts('match.js');

const DEFAULTS = {
  autoRedirect: true,
  newTab: false,
  preferred: 'nebula',
  showButton: true,
  nebulaSubscribed: false,
  floatplaneCreators: [], // Floatplane creator IDs the user says they subscribe to
};
const DAY = 24 * 3600 * 1000;
const NEBULA_API = 'https://content.api.nebula.app';
const NEBULA_HEADERS = { 'Accept': 'application/json', 'Nebula-Platform': 'web' };
const FP = 'https://www.floatplane.com';

// Every link Detour puts on YouTube must be an https link to Nebula or Floatplane. Links come
// from Nebula's API / RSS and Floatplane's API, so a bad or spoofed response could otherwise
// inject e.g. a javascript: URL that runs on youtube.com when clicked or auto-redirected to.
const ALLOWED_HOSTS = new Set(['nebula.tv', 'www.nebula.tv', 'nebula.app', 'www.nebula.app', 'floatplane.com', 'www.floatplane.com']);
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) ? u.href : null;
  } catch { return null; }
}
const sanitizeResults = results => results.map(r => ({ ...r, url: safeUrl(r.url) })).filter(r => r.url);

// Identify Detour (and its version) to Nebula and Floatplane, as Floatplane asks API clients to:
// the browser's own User-Agent with "Detour/<version> (+repo URL)" appended.
const DETOUR_UA_TOKEN = `Detour/${chrome.runtime.getManifest().version} (+https://github.com/josh345rtfvqw/detour)`;
const DETOUR_UA = `${(typeof navigator !== 'undefined' && navigator.userAgent) || ''} ${DETOUR_UA_TOKEN}`.trim();
const UA_RULE_ID = 1;

// fetch() can't change User-Agent in Chrome, so a session header rule sets it on requests the
// extension itself makes (tabId -1) to these sites. The user's own browsing isn't touched.
async function installUserAgentRule() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [UA_RULE_ID],
      addRules: [{
        id: UA_RULE_ID, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'User-Agent', operation: 'set', value: DETOUR_UA }] },
        condition: { requestDomains: ['floatplane.com', 'nebula.app', 'nebula.tv'], tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] },
      }],
    });
  } catch (e) { console.warn('[detour] could not set User-Agent rule', e); }
}
const uaReady = installUserAgentRule();

// All network requests go through here: waits for the header rule, and also sets User-Agent
// directly (Firefox honours that even where the rule isn't available).
async function detourFetch(url, init = {}) {
  await uaReady;
  return fetch(url, { ...init, headers: { ...(init.headers || {}), 'User-Agent': DETOUR_UA } });
}

// Auto-redirect needs a title match of at least 75%. (Videos in the master list's videos table
// are exact matches, so this only affects videos matched by title in the browser.) It used to be
// a setting; it's fixed now, and any old saved value is ignored and cleared.
const REDIRECT_MIN_CONFIDENCE = 0.75;
chrome.storage.sync.remove('minConfidence').catch(() => {});
const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)), minConfidence: REDIRECT_MIN_CONFIDENCE });

async function getJSON(url, init = {}) {
  const res = await detourFetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Cache helper backed by storage.local, so it survives service-worker restarts.
async function cached(key, maxAge, loader) {
  const hit = (await chrome.storage.local.get(key))[key];
  if (hit && Date.now() - hit.t < maxAge) return hit.v;
  let v;
  try {
    v = await loader();
  } catch (e) {
    console.warn('[detour] load failed', key, e);
    if (hit) return hit.v; // stale is better than nothing
    throw e;
  }
  try {
    await chrome.storage.local.set({ [key]: { t: Date.now(), v } });
    if (key.startsWith('neb:')) await pruneCaches('neb:', 60);
    if (key.startsWith('cat:')) await pruneCaches('cat:', 25);
  } catch (e) { console.warn('[detour] cache write failed', key, e); } // still return the data
  return v;
}

// Per-creator caches would otherwise pile up in storage forever: keep the newest few.
async function pruneCaches(prefix, keep) {
  const all = await chrome.storage.local.get(null);
  const old = Object.entries(all).filter(([k]) => k.startsWith(prefix))
    .sort((a, b) => (b[1]?.t || 0) - (a[1]?.t || 0)).slice(keep).map(([k]) => k);
  if (old.length) await chrome.storage.local.remove(old);
}

// ---------------------------------------------------------------- master list + match cache

// Master list published on GitHub Pages and updated without a new extension version (data
// only, never code): known YouTube -> Nebula/Floatplane videos and the Floatplane creator list.
// GitHub Pages allows cross-origin reads, so no extra permission is needed. Fetching it sends
// nothing about what the user watches. Every URL in it is checked with safeUrl().
const DATA_BASE = 'https://josh345rtfvqw.github.io/detour/data';
const MASTER_URL = `${DATA_BASE}/known.json`;
const FP_POST_ID = /^\w{1,64}$/;
const NEBULA_PODCAST_EPISODE = /^[\w-]{1,100}\/[\w-]{1,100}$/; // "<show>/<episode>" in the master list
const YT_VIDEO_ID = /^[\w-]{11}$/;

const YT_CHANNEL_ID = /^UC[\w-]{22}$/;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');

// Master list, version 3. Keyed by YouTube, the anchor for every lookup:
//   videos   { "<YouTube video ID>":   { nebula: "<video slug>" | "<podcast>/<episode>", floatplane: "<post id>" } }
//   channels { "<YouTube channel ID>": { name, nebula: "<slug>", floatplane: "<creator id>[/<channel id>]" } }
//   nebula.creators { "<slug>": { name, catalog } }
//   floatplane.creators { "<creator id>": { name, urlname, channels: { "<id>": { name, urlname } }, catalog } }
// It holds IDs only. Links are built here, and every ID is validated before use. The result
// uses the same shapes the lookups already work with:
//   nebula / floatplane: { videos: { yt: url }, creators: [...], catalogs: [...] }
function parseMasterV3(d) {
  const videos = { nebula: {}, floatplane: {} };
  for (const [id, row] of Object.entries(isObj(d.videos) ? d.videos : {})) {
    if (!YT_VIDEO_ID.test(id) || !isObj(row)) continue;
    if (SLUG.test(str(row.nebula))) videos.nebula[id] = `https://nebula.tv/videos/${row.nebula}`;
    else if (NEBULA_PODCAST_EPISODE.test(str(row.nebula))) videos.nebula[id] = `https://nebula.tv/${row.nebula}/`;
    if (FP_POST_ID.test(str(row.floatplane))) videos.floatplane[id] = `${FP}/post/${row.floatplane}`;
  }

  // channels table: YouTube channel ID per Nebula slug / Floatplane creator or sub-channel.
  const nebYt = {}, fpYt = {};
  for (const [uc, row] of Object.entries(isObj(d.channels) ? d.channels : {})) {
    if (!YT_CHANNEL_ID.test(uc) || !isObj(row)) continue;
    if (SLUG.test(str(row.nebula))) nebYt[row.nebula] = uc;
    if (/^\w{1,64}(\/\w{1,64})?$/.test(str(row.floatplane))) (fpYt[row.floatplane] ||= []).push(`https://www.youtube.com/channel/${uc}`);
  }

  const nebCreators = Object.entries(isObj(d.nebula?.creators) ? d.nebula.creators : {})
    .filter(([slug, c]) => SLUG.test(slug) && isObj(c) && typeof c.name === 'string')
    .map(([slug, c]) => ({ name: c.name, slug, alt: null, ytId: nebYt[slug] || null, catalog: c.catalog === true }));

  const fpCreators = Object.entries(isObj(d.floatplane?.creators) ? d.floatplane.creators : {})
    .filter(([id, c]) => FP_POST_ID.test(id) && isObj(c) && typeof c.name === 'string')
    .map(([id, c]) => ({
      id, title: c.name, urlname: str(c.urlname) || null, icon: '', builtin: true, catalog: c.catalog === true, links: fpYt[id] || [],
      channels: Object.entries(isObj(c.channels) ? c.channels : {}).filter(([chId, ch]) => FP_POST_ID.test(chId) && isObj(ch))
        .map(([chId, ch]) => ({ id: chId, title: str(ch.name) || c.name, urlname: str(ch.urlname) || null, links: fpYt[`${id}/${chId}`] || [] })),
    }));

  return {
    nebula: { videos: videos.nebula, creators: nebCreators, catalogs: nebCreators.filter(c => c.catalog).map(c => c.slug) },
    floatplane: { videos: videos.floatplane, creators: fpCreators, catalogs: fpCreators.filter(c => c.catalog).map(c => c.id) },
  };
}

function loadMaster() {
  return cached('masterList3', 12 * 3600 * 1000, async () => {
    // Plain fetch (no custom headers) so the cross-origin request needs no preflight.
    const res = await fetch(MASTER_URL, { credentials: 'omit', cache: 'no-cache' });
    if (!res.ok) throw new Error(`master list ${res.status}`);
    const d = await res.json();
    if (!isObj(d) || d.version !== 3) throw new Error('unsupported master list version');
    return parseMasterV3(d);
  });
}
const EMPTY_MASTER = { nebula: { videos: {}, creators: null, catalogs: [] }, floatplane: { videos: {}, creators: null, catalogs: [] } };
const masterOrEmpty = () => loadMaster().catch(() => EMPTY_MASTER);

// A creator's full video catalogue from the master list (data/nebula/<slug>.json or
// data/floatplane/<id>.json), downloaded only for creators the user actually watches.
// Returns match candidates, or null if there's no catalogue for that creator.
async function loadCatalog(kind, name) {
  const master = await masterOrEmpty();
  if (!master[kind].catalogs.includes(name)) return null;
  try {
    return await cached(`cat:${kind}:${name}`, 12 * 3600 * 1000, async () => {
      const res = await fetch(`${DATA_BASE}/${kind}/${name}.json`, { credentials: 'omit', cache: 'no-cache' });
      if (!res.ok) throw new Error(`catalogue ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error('bad catalogue');
      return kind === 'nebula'
        ? list.filter(e => e && SLUG.test(e.s || '') && typeof e.t === 'string').map(e => ({ title: e.t, date: e.d, url: `https://nebula.tv/videos/${e.s}` }))
        : list.filter(p => p && FP_POST_ID.test(p.i || '') && typeof p.t === 'string').map(p => ({ title: p.t, date: p.d, url: `${FP}/post/${p.i}`, channel: p.c }));
    });
  } catch (e) { console.warn('[detour] catalogue unavailable', kind, name, e); return null; }
}

// Confirmed matches remembered locally, so revisits need no network requests (and don't send
// the title again). 30 days, at most 2000 entries.
const MATCH_TTL = 30 * DAY;
const MATCH_MIN_CONFIDENCE = 0.75;
async function getCachedMatch(platform, videoId) {
  if (!videoId) return null;
  const { matches = {} } = await chrome.storage.local.get('matches');
  const m = matches[`${platform}:${videoId}`];
  return m && Date.now() - m.t < MATCH_TTL && safeUrl(m.url) ? m : null;
}
async function putCachedMatch(platform, videoId, url, title) {
  if (!videoId || !safeUrl(url)) return;
  try {
    const { matches = {} } = await chrome.storage.local.get('matches');
    matches[`${platform}:${videoId}`] = { url, title: title || '', t: Date.now() };
    const entries = Object.entries(matches).filter(([, m]) => Date.now() - m.t < MATCH_TTL).sort((a, b) => b[1].t - a[1].t).slice(0, 2000);
    await chrome.storage.local.set({ matches: Object.fromEntries(entries) });
  } catch (e) { console.warn('[detour] match cache write failed', e); }
}

// ---------------------------------------------------------------- Nebula

// YouTube channel ID -> Nebula channel slug, from Nebula's public creator wall
// (talent.nebula.tv/creators). Each creator card carries the YouTube channel ID
// (data-video), the creator's name (image alt text) and a link to their Nebula channel.
// Nebula's creators: from the master list when available (no request to Nebula), else from
// Nebula's creator wall.
async function loadNebulaCreators() {
  const fromMaster = (await masterOrEmpty()).nebula.creators;
  if (fromMaster && fromMaster.length) return fromMaster;
  return cached('nebulaCreators', DAY, async () => {
    const res = await detourFetch('https://talent.nebula.tv/creators/', { credentials: 'omit' });
    if (!res.ok) throw new Error(`creator wall ${res.status}`);
    const creators = parseCreatorWall(await res.text());
    if (!creators.length) throw new Error('no creators found on talent.nebula.tv (page layout may have changed)');
    return creators;
  });
}

function loadNebulaEpisodes(slug) {
  return cached(`neb:${slug}`, 6 * 3600 * 1000, async () => {
    try {
      const channel = await getJSON(`${NEBULA_API}/content/${slug}/`, { headers: NEBULA_HEADERS, credentials: 'omit' });
      const body = await getJSON(`${NEBULA_API}/video_channels/${channel.id}/video_episodes/?page_size=100`,
        { headers: NEBULA_HEADERS, credentials: 'omit' });
      return body.results.map(v => ({ title: v.title, date: v.published_at, url: v.share_url || `https://nebula.tv/videos/${v.slug}` }));
    } catch (e) {
      console.warn('[detour] nebula API failed, trying RSS', slug, e);
      return loadNebulaRss(slug);
    }
  });
}

// Nebula's public per-channel RSS feed (see blog.nebula.tv/rss-feed). Fewer items than the API.
async function loadNebulaRss(slug) {
  const res = await detourFetch(`https://rss.nebula.app/video/channels/${slug}.rss`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  const xml = await res.text();
  const text = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
    return m ? m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'") : '';
  };
  return xml.split('<item').slice(1).map(item => ({ title: text(item, 'title'), date: text(item, 'pubDate'), url: text(item, 'link') }))
    .filter(v => v.title && v.url);
}

async function searchNebula(title, slugs) {
  const body = await getJSON(`${NEBULA_API}/video_episodes/search/?q=${encodeURIComponent(title)}&page_size=20`,
    { headers: NEBULA_HEADERS, credentials: 'omit' });
  return body.results
    .filter(v => slugs.includes(v.channel_slug) || (v.channel_slugs || []).some(s => slugs.includes(s)))
    .map(v => ({ title: v.title, date: v.published_at, url: v.share_url || `https://nebula.tv/videos/${v.slug}` }));
}

async function lookupNebula(info, settings) {
  // Known video (master list or this browser's earlier match): no requests to Nebula.
  const known = (await masterOrEmpty()).nebula.videos[info.videoId] || (await getCachedMatch('nebula', info.videoId))?.url;
  if (known) return { platform: 'nebula', subscribed: settings.nebulaSubscribed, creator: info.author || '', kind: 'video', url: known, title: info.title, confidence: 1 };

  const creators = await loadNebulaCreators();
  const author = normalizeName(info.author);
  const matches = creators.filter(c => (info.channelId && c.ytId === info.channelId) ||
    (!info.channelId && author && normalizeName(c.name) === author));
  if (!matches.length) return null;

  const slugs = [...new Set(matches.flatMap(c => [c.slug, c.alt]).filter(Boolean))];
  let best = null;
  let allCatalogued = true;
  for (const slug of slugs) {
    try {
      // Full catalogue from the master list if there is one, else Nebula's newest 100.
      let cands = await loadCatalog('nebula', slug);
      if (!cands) { allCatalogued = false; cands = await loadNebulaEpisodes(slug); }
      const m = bestMatch(info.title, info.publishDate, cands);
      if (m && (!best || m.confidence > best.confidence)) best = m;
    } catch (e) { console.warn('[detour] nebula episodes', slug, e); }
  }
  // Older videos fall outside the newest 100: try Nebula's search (not needed with a full catalogue).
  if (!allCatalogued && (!best || best.confidence < settings.minConfidence)) {
    try {
      const m = bestMatch(info.title, info.publishDate, await searchNebula(info.title, slugs));
      if (m && (!best || m.confidence > best.confidence)) best = m;
    } catch (e) { console.warn('[detour] nebula search', e); }
  }
  const base = { platform: 'nebula', subscribed: settings.nebulaSubscribed, creator: matches[0].name };
  if (best && best.confidence >= MATCH_MIN_CONFIDENCE) await putCachedMatch('nebula', info.videoId, best.url, best.title);
  if (best && best.confidence >= 0.45) return { ...base, kind: 'video', url: best.url, title: best.title, confidence: best.confidence };
  return { ...base, kind: 'channel', url: `https://nebula.tv/${slugs[0]}`, confidence: 0 };
}

// ---------------------------------------------------------------- Floatplane
// Uses the user's own floatplane.com login cookies (credentials: 'include').

// Floatplane's live creator list, merged with the master list's creators. If the live list
// can't be loaded (not logged in), the master list's creators are used on their own.
async function loadFloatplaneCreators() {
  let live = [];
  try {
    live = await cached('fpCreators', DAY, async () => {
      const list = await getJSON(`${FP}/api/v3/creator/list?search=`, { credentials: 'include' });
      return list.map(c => ({
        id: c.id, title: c.title, urlname: c.urlname,
        icon: c.icon?.path || '',
        links: Object.values(c.socialLinks || {}),
        channels: (c.channels || []).map(ch => ({ id: ch.id, title: ch.title, urlname: ch.urlname, links: Object.values(ch.socialLinks || {}) })),
      }));
    });
  } catch (e) { console.warn('[detour] using the master list\'s Floatplane creators', e); }
  const byId = new Map(live.map(c => [c.id, c]));
  const byName = new Map(live.map(c => [fpNameKey(c.title), c]));
  // Known creators come from the master list, which is updated without a release.
  const known = (await masterOrEmpty()).floatplane.creators || [];
  for (const d of known) {
    // Same creator if the ID matches, else if the name does.
    const c = byId.get(d.id) || byName.get(fpNameKey(d.title));
    if (!c) { byId.set(d.id, d); continue; }
    // Live data wins, but keep the master list's YouTube links and channels where live has none.
    if (!c.links.some(l => /youtube/.test(l))) c.links = [...c.links, ...d.links];
    for (const dch of d.channels) {
      const ch = c.channels.find(x => x.id === dch.id);
      if (!ch) c.channels.push(dch);
      else if (!ch.links.some(l => /youtube/.test(l))) ch.links = [...ch.links, ...dch.links];
    }
  }
  return [...byId.values()];
}

// Turn a YouTube URL into comparable identifiers: channel ID, @handle, /user/ or /c/ name.
function ytIdentifiers(url) {
  const ids = [];
  try {
    const p = new URL(url).pathname.split('/').filter(Boolean);
    if (p[0]?.startsWith('@')) ids.push(p[0].slice(1).toLowerCase());
    else if (['channel', 'user', 'c'].includes(p[0]) && p[1]) ids.push(p[0] === 'channel' ? p[1] : p[1].toLowerCase());
    else if (p[0]) ids.push(p[0].toLowerCase());
  } catch { /* not a URL */ }
  return ids;
}

function floatplaneMatches(creators, info) {
  const mine = new Set([info.channelId, ...ytIdentifiers(info.profileUrl || '')].filter(Boolean));
  const author = normalizeName(info.author);
  const linked = links => links.filter(l => /youtube\.com|youtu\.be/.test(l)).some(l => ytIdentifiers(l).some(i => mine.has(i)));
  const out = [];
  for (const c of creators) {
    const channelHits = c.channels.filter(ch => linked(ch.links) || (author && normalizeName(ch.title) === author));
    if (channelHits.length) channelHits.forEach(ch => out.push({ creator: c, channel: ch }));
    else if (linked(c.links) || (author && normalizeName(c.title) === author)) out.push({ creator: c, channel: null });
  }
  return out;
}

// Subscribed if the user ticked this creator by its ID, or by name (built-in entries whose
// Floatplane ID isn't known are remembered by name, and still count once the live list loads).
const isFpSubscribed = (c, list) => list.includes(c.id) || list.includes(fpNameKey(c.title));
const fpKnown = c => !!c.urlname && !String(c.id).startsWith('name:');

function fpChannelUrl(c, ch) {
  if (!fpKnown(c)) return `${FP}/`; // address not known yet: Floatplane's home page
  const chPath = ch && ch.urlname && ch.urlname !== c.urlname ? `/${ch.urlname}` : '';
  return `${FP}/channel/${c.urlname}/home${chPath}`;
}

async function floatplanePosts(creatorId, channelId, search) {
  const q = new URLSearchParams({ id: creatorId, limit: '20', hasVideo: 'true' });
  if (channelId) q.set('channel', channelId);
  if (search) q.set('search', search);
  const posts = await getJSON(`${FP}/api/v3/content/creator?${q}`, { credentials: 'include' });
  return posts.map(p => ({ title: p.title, date: p.releaseDate, url: `${FP}/post/${p.id}` }));
}

async function lookupFloatplane(info, settings) {
  const hits = floatplaneMatches(await loadFloatplaneCreators(), info);
  if (!hits.length) return null;
  // Known video (master list or this browser's earlier match): no post search needed.
  const known = (await masterOrEmpty()).floatplane.videos[info.videoId] || (await getCachedMatch('floatplane', info.videoId))?.url;
  if (known) {
    const c = hits[0].creator;
    return { platform: 'floatplane', subscribed: isFpSubscribed(c, settings.floatplaneCreators), creator: c.title, kind: 'video', url: known, title: info.title, confidence: 1 };
  }
  let best = null, bestHit = hits[0];
  for (const hit of hits) {
    const catalog = await loadCatalog('floatplane', hit.creator.id);
    if (catalog) {
      // Full catalogue from the master list: match locally, no request to Floatplane.
      const m = bestMatch(info.title, info.publishDate, hit.channel ? catalog.filter(p => !p.channel || p.channel === hit.channel.id) : catalog);
      if (m && (!best || m.confidence > best.confidence)) { best = m; bestHit = hit; }
      continue;
    }
    const cands = [];
    if (!fpKnown(hit.creator)) continue; // can't search posts without the creator's ID
    for (const search of [info.title, '']) { // title search, then the newest posts
      try { cands.push(...await floatplanePosts(hit.creator.id, hit.channel?.id, search)); }
      catch (e) { console.warn('[detour] floatplane posts', e); }
    }
    const m = bestMatch(info.title, info.publishDate, cands);
    if (m && (!best || m.confidence > best.confidence)) { best = m; bestHit = hit; }
  }
  const c = bestHit.creator;
  const base = { platform: 'floatplane', subscribed: isFpSubscribed(c, settings.floatplaneCreators), creator: c.title };
  if (best && best.confidence >= MATCH_MIN_CONFIDENCE) await putCachedMatch('floatplane', info.videoId, best.url, best.title);
  if (best && best.confidence >= 0.45) return { ...base, kind: 'video', url: best.url, title: best.title, confidence: best.confidence };
  return { ...base, kind: 'channel', url: fpChannelUrl(c, bestHit.channel), confidence: 0 };
}

// ---------------------------------------------------------------- channel pages
// Only needs the channel mapping: no per-video lookups.

async function channelOnNebula(info, settings) {
  const creators = await loadNebulaCreators();
  const author = normalizeName(info.author);
  const c = creators.find(c => (info.channelId && c.ytId === info.channelId)) ||
    creators.find(c => author && normalizeName(c.name) === author);
  if (!c) return null;
  return { platform: 'nebula', kind: 'channel', url: `https://nebula.tv/${c.slug || c.alt}`, creator: c.name, subscribed: settings.nebulaSubscribed, confidence: 0 };
}

async function channelOnFloatplane(info, settings) {
  const [hit] = floatplaneMatches(await loadFloatplaneCreators(), info);
  if (!hit) return null;
  const c = hit.creator;
  return { platform: 'floatplane', kind: 'channel', url: fpChannelUrl(c, hit.channel), creator: c.title, subscribed: isFpSubscribed(c, settings.floatplaneCreators), confidence: 0 };
}

async function lookupChannel(info) {
  const settings = await getSettings();
  const results = sanitizeResults((await Promise.allSettled([channelOnNebula(info, settings), channelOnFloatplane(info, settings)]))
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean));
  results.sort((a, b) => (b.subscribed - a.subscribed) || ((b.platform === settings.preferred) - (a.platform === settings.preferred)));
  return results;
}

// ---------------------------------------------------------------- messages

// videoId -> { t, results }. Kept 10 minutes, only when both lookups succeeded, and cleared
// whenever settings change (results carry the "subscribed" flag, which depends on them).
const recent = new Map();
const RECENT_TTL = 10 * 60 * 1000;
chrome.storage.onChanged.addListener((_changes, area) => { if (area === 'sync') recent.clear(); });

async function lookup(info) {
  const hit = recent.get(info.videoId);
  if (hit && Date.now() - hit.t < RECENT_TTL) return hit.results;
  const settings = await getSettings();
  const settled = await Promise.allSettled([lookupNebula(info, settings), lookupFloatplane(info, settings)]);
  const results = sanitizeResults(settled.map(r => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean));
  // Order: subscribed first, then video over channel, then preferred platform, then confidence.
  results.sort((a, b) => (b.subscribed - a.subscribed) || ((b.kind === 'video') - (a.kind === 'video')) ||
    ((b.platform === settings.preferred) - (a.platform === settings.preferred)) || (b.confidence - a.confidence));
  if (settled.every(r => r.status === 'fulfilled')) {
    recent.set(info.videoId, { t: Date.now(), results });
    if (recent.size > 200) recent.delete(recent.keys().next().value);
  }
  return results;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handle = async () => {
    if (msg.type === 'lookup') return { results: await lookup(msg.info), settings: await getSettings() };
    if (msg.type === 'lookupChannel') return { results: await lookupChannel(msg.info), settings: await getSettings() };
    if (msg.type === 'fpCreators') return { creators: await loadFloatplaneCreators() };
    if (msg.type === 'clearCache') {
      // Refresh data, but keep the user's dismissed channel banners.
      recent.clear();
      const { dismissedChannels } = await chrome.storage.local.get('dismissedChannels');
      await chrome.storage.local.clear();
      if (dismissedChannels) await chrome.storage.local.set({ dismissedChannels });
      return { ok: true };
    }
    // Auto-redirect in a new tab: opened from here, because window.open from a timer in the
    // page is blocked as a popup.
    if (msg.type === 'openTab') {
      const url = safeUrl(msg.url);
      if (!url) throw new Error('refused to open a non-Nebula/Floatplane URL');
      await chrome.tabs.create({ url, active: true });
      return { ok: true };
    }
  };
  handle().then(reply, e => reply({ error: String(e?.message || e) }));
  return true; // async reply
});
