// Content script on YouTube.
// Video pages: ask the background whether the video is on Nebula/Floatplane, then either
// auto-redirect or show a badge on the player. Channel pages: show a banner if the
// channel is on one of them.
(() => {
  const SKIP_KEY = 'detourSkip';
  const NAMES = { nebula: 'Nebula', floatplane: 'Floatplane' };
  const MARKS = { nebula: 'N', floatplane: 'F' };
  const CHANNEL_PATH = /^\/(@[^/]+|channel\/UC[\w-]+|c\/[^/]+|user\/[^/]+)(\/|$)/;

  let currentKey = null;
  let ui = [];
  let countdownTimer = null;

  // ------------------------------------------------------------ helpers

  const videoIdFromUrl = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const channelPathFromUrl = () => (CHANNEL_PATH.test(location.pathname) ? location.pathname.match(CHANNEL_PATH)[0].replace(/\/$/, '') : null);
  const pageKey = () => {
    const v = videoIdFromUrl();
    if (v) return `v:${v}`;
    const c = channelPathFromUrl();
    return c ? `c:${c}` : null;
  };

  const skipped = () => { try { return JSON.parse(sessionStorage.getItem(SKIP_KEY) || '[]'); } catch { return []; } };
  const markSkipped = id => { try { sessionStorage.setItem(SKIP_KEY, JSON.stringify([...skipped(), id].slice(-200))); } catch { /* ignore */ } };
  const pause = () => window.postMessage({ source: 'detour-cs', type: 'pause' }, '*');

  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    children.flat().forEach(c => c != null && e.append(c));
    return e;
  }

  const svg = (paths, size = 16) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }).forEach(([k, v]) => s.setAttribute(k, v));
    for (const d of paths) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      s.append(p);
    }
    return s;
  };
  const ICON_ARROW = ['M5 12h14', 'M13 6l6 6-6 6'];
  const ICON_OUT = ['M7 17L17 7', 'M8 7h9v9'];
  const ICON_X = ['M6 6l12 12', 'M18 6L6 18'];
  const mark = (platform, cls) => el('span', { class: `detour-mark ${cls || ''}` }, MARKS[platform]);

  function clearUI() {
    clearInterval(countdownTimer);
    ui.forEach(n => n.remove());
    ui = [];
  }

  // Ask page.js (main world) for data, retrying until YouTube has the new page's data.
  function askPage(msg) {
    return new Promise(resolve => {
      const nonce = Math.random().toString(36).slice(2);
      const onMsg = ev => {
        if (ev.source !== window || ev.data?.source !== 'detour-page' || ev.data.nonce !== nonce) return;
        window.removeEventListener('message', onMsg);
        resolve(ev.data.info);
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'detour-cs', nonce, ...msg }, '*');
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 500);
    });
  }

  async function poll(key, msg, ok) {
    for (let i = 0; i < 30; i++) {
      if (pageKey() !== key) return null; // navigated away
      const info = await askPage(msg);
      if (ok(info)) return info;
      await new Promise(r => setTimeout(r, 300));
    }
    return null;
  }

  async function ask(type, info) {
    try {
      const resp = await chrome.runtime.sendMessage({ type, info });
      if (resp?.error) console.warn('[detour]', resp.error);
      return resp && !resp.error ? resp : null;
    } catch (e) { console.warn('[detour]', e); return null; }
  }

  // ------------------------------------------------------------ video page: player badge

  function subtitle(r) {
    if (r.kind === 'channel') return 'Video not found, open the channel';
    return r.subscribed ? 'Included in your subscription' : `Also available on ${NAMES[r.platform]}`;
  }

  function showBadges(results) {
    clearUI();
    const player = document.getElementById('movie_player');
    const box = el('div', { class: `detour-badges${player ? '' : ' detour-floating'}` });
    for (const r of results) {
      const link = el('a', {
        class: `detour-badge detour-${r.platform}`,
        href: r.url, target: '_blank', rel: 'noopener',
        title: r.kind === 'video' ? `Matched “${r.title}” (${Math.round(r.confidence * 100)}% confidence)` : `${r.creator || 'This channel'} is on ${NAMES[r.platform]}`,
        onclick: pause,
      },
      mark(r.platform),
      el('span', { class: 'detour-text' },
        el('span', { class: 'detour-title' }, r.kind === 'video' ? `Watch on ${NAMES[r.platform]}` : `${r.creator || 'Channel'} on ${NAMES[r.platform]}`),
        el('span', { class: 'detour-sub' }, subtitle(r))),
      svg(ICON_ARROW));
      const close = el('button', { class: 'detour-close', 'aria-label': 'Hide', onclick: e => { e.preventDefault(); e.stopPropagation(); clearUI(); } }, svg(ICON_X, 14));
      box.append(el('div', { class: 'detour-badge-row' }, link, close));
    }
    (player || document.body).append(box);
    ui.push(box);

    // Shrink to just the mark once the video has been playing a while; hovering expands it.
    const video = player?.querySelector('video');
    if (video) {
      let t;
      const compact = () => { clearTimeout(t); t = setTimeout(() => box.classList.add('detour-compact'), 6000); };
      if (!video.paused) compact();
      video.addEventListener('play', compact);
      video.addEventListener('pause', () => { clearTimeout(t); box.classList.remove('detour-compact'); });
    }
  }

  function autoRedirect(r, settings, videoId) {
    clearUI();
    pause();
    markSkipped(videoId); // never redirect the same video twice in this tab (e.g. after Back)
    let left = 3;
    const go = () => {
      clearUI();
      if (settings.newTab) window.open(r.url, '_blank', 'noopener');
      else location.assign(r.url);
    };
    const msg = el('span', { class: 'detour-title' }, `Opening on ${NAMES[r.platform]} in ${left}s…`);
    const toast = el('div', { class: `detour-toast detour-${r.platform}`, role: 'status' },
      mark(r.platform),
      msg,
      el('button', { class: 'detour-action', onclick: go }, 'Go now'),
      el('button', { class: 'detour-stay', onclick: clearUI }, 'Stay on YouTube'));
    document.body.append(toast);
    ui.push(toast);
    countdownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) go();
      else msg.textContent = `Opening on ${NAMES[r.platform]} in ${left}s…`;
    }, 1000);
  }

  async function handleVideo(key, videoId) {
    let info = await poll(key, { type: 'getInfo', videoId }, i => i?.title);
    if (!info && pageKey() === key) {
      // Fallback: scrape the DOM (no channel ID, so matching relies on the channel name).
      const title = document.querySelector('h1.ytd-watch-metadata, h1.title')?.textContent?.trim();
      const owner = document.querySelector('ytd-video-owner-renderer a[href^="/@"], ytd-channel-name a');
      if (title) info = { videoId, title, author: owner?.textContent?.trim() || '', profileUrl: owner ? owner.href : '', channelId: '' };
    }
    if (!info) return;
    const resp = await ask('lookup', info);
    if (!resp || pageKey() !== key || !resp.results.length) return;

    const { results, settings } = resp;
    const best = results[0];
    const canRedirect = settings.autoRedirect && best.subscribed && best.kind === 'video' &&
      best.confidence >= settings.minConfidence && !skipped().includes(videoId);
    if (canRedirect) return autoRedirect(best, settings, videoId);
    const shown = results.filter(r => r.subscribed || settings.showButton);
    if (shown.length) showBadges(shown);
  }

  // ------------------------------------------------------------ channel page: banner

  async function dismissed() {
    return (await chrome.storage.local.get({ dismissedChannels: [] })).dismissedChannels;
  }

  function showBanners(results, info) {
    clearUI();
    const anchor = document.querySelector('#tabs-container, tp-yt-app-toolbar#tabs-container, ytd-tabbed-page-header #tabs-inner-container');
    const header = document.querySelector('#page-header, ytd-c4-tabbed-header-renderer');
    for (const r of results) {
      const id = `${r.platform}:${info.channelId || info.author}`;
      const banner = el('div', { class: `detour-banner detour-${r.platform}${anchor || header ? '' : ' detour-floating'}`, role: 'region', 'aria-label': `${NAMES[r.platform]} link` },
        mark(r.platform, 'detour-mark-lg'),
        el('div', { class: 'detour-text' },
          el('span', { class: 'detour-title' }, `${info.author || r.creator} is also on ${NAMES[r.platform]}`),
          el('span', { class: 'detour-sub' }, r.subscribed
            ? 'You subscribe there, so you can watch their videos without ads.'
            : `Their videos are on ${NAMES[r.platform]} too.`)),
        el('a', { class: 'detour-action', href: r.url, target: '_blank', rel: 'noopener' }, `Open on ${NAMES[r.platform]}`, svg(ICON_OUT, 14)),
        el('button', {
          class: 'detour-close', 'aria-label': 'Don’t show for this channel',
          onclick: async () => {
            banner.remove();
            const list = await dismissed();
            await chrome.storage.local.set({ dismissedChannels: [...new Set([...list, id])].slice(-500) });
          },
        }, svg(ICON_X)));
      banner.dataset.id = id;
      if (anchor) anchor.before(banner);
      else if (header) header.after(banner);
      else document.body.append(banner);
      ui.push(banner);
    }
  }

  async function handleChannel(key, path) {
    const info = await poll(key, { type: 'getChannel', path }, i => i?.channelId || i?.author);
    if (!info) return;
    const resp = await ask('lookupChannel', info);
    if (!resp || pageKey() !== key) return;
    const hidden = await dismissed();
    const shown = resp.results.filter(r => (r.subscribed || resp.settings.showButton) &&
      !hidden.includes(`${r.platform}:${info.channelId || info.author}`));
    if (shown.length) showBanners(shown, info);
  }

  // ------------------------------------------------------------ navigation

  async function onNavigate() {
    const key = pageKey();
    if (key === currentKey) return;
    currentKey = key;
    clearUI();
    if (!key) return;
    if (key.startsWith('v:')) handleVideo(key, key.slice(2));
    else handleChannel(key, key.slice(2));
  }

  document.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('popstate', onNavigate);
  setInterval(onNavigate, 1000); // catch-all for mobile site / missed events
  onNavigate();
})();
