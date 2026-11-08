// Background: looks up whether a YouTube video exists on Nebula / Floatplane.
// Chrome runs this as a service worker (needs importScripts); Firefox loads match.js first.
if (typeof importScripts === 'function' && typeof bestMatch === 'undefined') importScripts('match.js', 'floatplane-defaults.js');

const DEFAULTS = {
  autoRedirect: true,
  newTab: false,
  minConfidence: 0.75,
  preferred: 'nebula',
  showButton: true,
  nebulaSubscribed: false,
  floatplaneCreators: [], // Floatplane creator IDs the user says they subscribe to
};
const DAY = 24 * 3600 * 1000;
const NEBULA_API = 'https://content.api.nebula.app';
const NEBULA_HEADERS = { 'Accept': 'application/json', 'Nebula-Platform': 'web' };
const FP = 'https://www.floatplane.com';

const getSettings = async () => ({ ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) });

async function getJSON(url, init = {}) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Cache helper backed by storage.local, so it survives service-worker restarts.
async function cached(key, maxAge, loader) {
  const hit = (await chrome.storage.local.get(key))[key];
  if (hit && Date.now() - hit.t < maxAge) return hit.v;
  try {
    const v = await loader();
    await chrome.storage.local.set({ [key]: { t: Date.now(), v } });
    return v;
  } catch (e) {
    console.warn('[detour] load failed', key, e);
    if (hit) return hit.v; // stale is better than nothing
    throw e;
  }
}

// ---------------------------------------------------------------- Nebula

// YouTube channel ID -> Nebula channel slug.
// Sources: Nebula's public creator wall, plus the community-maintained list from
// the "Enhancer for Nebula" project (github.com/cpiber/NebulaEnhance).
function loadNebulaCreators() {
  return cached('nebulaCreators', DAY, async () => {
    const creators = [];
    try {
      const list = await getJSON('https://raw.githubusercontent.com/cpiber/NebulaEnhance/master/channels.json');
      for (const c of list) creators.push({ name: c.name, slug: c.nebula || c.nebulaAlt, alt: c.nebulaAlt, ytId: c.channel });
    } catch (e) { console.warn('[detour] channels.json', e); }
    try {
      const html = await (await fetch('https://talent.nebula.tv/creators/')).text();
      for (const block of html.split(/class="[^"]*\byoutube-creator\b/).slice(1)) {
        const ytId = (block.match(/data-video="(UC[\w-]{22})"/) || [])[1];
        const name = (block.match(/alt="([^"]*)"/) || [])[1];
        const link = (block.match(/href="https?:\/\/nebula\.tv\/([\w-]+)\/?"/) || [])[1];
        if (ytId && link && !creators.some(c => c.ytId === ytId)) creators.push({ name, slug: link, ytId });
      }
    } catch (e) { console.warn('[detour] talent page', e); }
    if (!creators.length) throw new Error('no Nebula creator data');
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
  const res = await fetch(`https://rss.nebula.app/video/channels/${slug}.rss`, { credentials: 'omit' });
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
  const creators = await loadNebulaCreators();
  const author = normalizeName(info.author);
  const matches = creators.filter(c => (info.channelId && c.ytId === info.channelId) ||
    (!info.channelId && author && normalizeName(c.name) === author));
  if (!matches.length) return null;

  const slugs = [...new Set(matches.flatMap(c => [c.slug, c.alt]).filter(Boolean))];
  let best = null;
  for (const slug of slugs) {
    try {
      const m = bestMatch(info.title, info.publishDate, await loadNebulaEpisodes(slug));
      if (m && (!best || m.confidence > best.confidence)) best = m;
    } catch (e) { console.warn('[detour] nebula episodes', slug, e); }
  }
  // Older videos fall outside the newest 100: try Nebula's search.
  if (!best || best.confidence < settings.minConfidence) {
    try {
      const m = bestMatch(info.title, info.publishDate, await searchNebula(info.title, slugs));
      if (m && (!best || m.confidence > best.confidence)) best = m;
    } catch (e) { console.warn('[detour] nebula search', e); }
  }
  const base = { platform: 'nebula', subscribed: settings.nebulaSubscribed, creator: matches[0].name };
  if (best && best.confidence >= 0.45) return { ...base, kind: 'video', url: best.url, title: best.title, confidence: best.confidence };
  return { ...base, kind: 'channel', url: `https://nebula.tv/${slugs[0]}`, confidence: 0 };
}

// ---------------------------------------------------------------- Floatplane
// Uses the user's own floatplane.com login cookies (credentials: 'include').

// Floatplane's live creator list, merged with the built-in defaults (floatplane-defaults.js).
// If the live list can't be loaded, the defaults alone are used.
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
  } catch (e) { console.warn('[detour] using built-in Floatplane creators', e); }
  const byId = new Map(live.map(c => [c.id, c]));
  for (const d of FLOATPLANE_DEFAULTS) {
    const c = byId.get(d.id);
    if (!c) { byId.set(d.id, d); continue; }
    // Live data wins, but keep the defaults' YouTube links and channels where live has none.
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
  let best = null, bestHit = hits[0];
  for (const hit of hits) {
    const cands = [];
    for (const search of [info.title, '']) { // title search, then the newest posts
      try { cands.push(...await floatplanePosts(hit.creator.id, hit.channel?.id, search)); }
      catch (e) { console.warn('[detour] floatplane posts', e); }
    }
    const m = bestMatch(info.title, info.publishDate, cands);
    if (m && (!best || m.confidence > best.confidence)) { best = m; bestHit = hit; }
  }
  const c = bestHit.creator;
  const base = { platform: 'floatplane', subscribed: settings.floatplaneCreators.includes(c.id), creator: c.title };
  if (best && best.confidence >= 0.45) return { ...base, kind: 'video', url: best.url, title: best.title, confidence: best.confidence };
  const chPath = bestHit.channel && bestHit.channel.urlname !== c.urlname ? `/${bestHit.channel.urlname}` : '';
  return { ...base, kind: 'channel', url: `${FP}/channel/${c.urlname}/home${chPath}`, confidence: 0 };
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
  const chPath = hit.channel && hit.channel.urlname !== c.urlname ? `/${hit.channel.urlname}` : '';
  return { platform: 'floatplane', kind: 'channel', url: `${FP}/channel/${c.urlname}/home${chPath}`, creator: c.title, subscribed: settings.floatplaneCreators.includes(c.id), confidence: 0 };
}

async function lookupChannel(info) {
  const settings = await getSettings();
  const results = (await Promise.allSettled([channelOnNebula(info, settings), channelOnFloatplane(info, settings)]))
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);
  results.sort((a, b) => (b.subscribed - a.subscribed) || ((b.platform === settings.preferred) - (a.platform === settings.preferred)));
  return results;
}

// ---------------------------------------------------------------- messages

const recent = new Map(); // videoId -> results, for this worker's lifetime

async function lookup(info) {
  if (recent.has(info.videoId)) return recent.get(info.videoId);
  const settings = await getSettings();
  const results = (await Promise.allSettled([lookupNebula(info, settings), lookupFloatplane(info, settings)]))
    .map(r => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);
  // Order: subscribed first, then video over channel, then preferred platform, then confidence.
  results.sort((a, b) => (b.subscribed - a.subscribed) || ((b.kind === 'video') - (a.kind === 'video')) ||
    ((b.platform === settings.preferred) - (a.platform === settings.preferred)) || (b.confidence - a.confidence));
  recent.set(info.videoId, results);
  return results;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handle = async () => {
    if (msg.type === 'lookup') return { results: await lookup(msg.info), settings: await getSettings() };
    if (msg.type === 'lookupChannel') return { results: await lookupChannel(msg.info), settings: await getSettings() };
    if (msg.type === 'fpCreators') return { creators: await loadFloatplaneCreators() };
    if (msg.type === 'clearCache') { recent.clear(); await chrome.storage.local.clear(); return { ok: true }; }
  };
  handle().then(reply, e => reply({ error: String(e?.message || e) }));
  return true; // async reply
});
