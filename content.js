// Content script on YouTube.
// Video pages: ask the background whether the video is on Nebula/Floatplane, then either
// auto-redirect or show a chip next to Like / Share. Channel pages: show a banner if the
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

  // Resolve with find()'s result once it's non-null, or null after `timeout` ms or when the
  // user navigates away. Watches DOM changes so it reacts as soon as YouTube renders.
  function waitFor(find, key, timeout = 15000) {
    return new Promise(resolve => {
      const found = find();
      if (found) return resolve(found);
      let done = false;
      const finish = v => { if (done) return; done = true; obs.disconnect(); clearTimeout(t); resolve(v); };
      const obs = new MutationObserver(() => {
        if (pageKey() !== key) return finish(null);
        const f = find();
        if (f) finish(f);
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      const t = setTimeout(() => finish(find()), timeout);
    });
  }

  async function ask(type, info) {
    try {
      const resp = await chrome.runtime.sendMessage({ type, info });
      if (resp?.error) console.warn('[detour]', resp.error);
      return resp && !resp.error ? resp : null;
    } catch (e) { console.warn('[detour]', e); return null; }
  }

  // ------------------------------------------------------------ video page: chip in the actions row

  function chipLabel(r) {
    if (r.kind === 'channel') return `${NAMES[r.platform]} channel`;
    return r.subscribed ? `Watch on ${NAMES[r.platform]}` : `Also on ${NAMES[r.platform]}`;
  }

  function chipTooltip(r) {
    if (r.kind === 'channel') return `This video wasn’t found, but ${r.creator || 'the channel'} is on ${NAMES[r.platform]}`;
    const sub = r.subscribed ? 'Included in your subscription. ' : '';
    return `${sub}Matched “${r.title}” (${Math.round(r.confidence * 100)}% confidence)`;
  }

  // The chip gets its own right-aligned row directly above the channel / Like / Share row
  // (YouTube's #top-row), in the gap under the video. It doesn't go inside YouTube's button
  // row, whose layout varies and which YouTube re-renders.
  const TOP_ROW = 'ytd-watch-metadata #top-row';
  const firstMatch = list => list.map(s => document.querySelector(s)).find(Boolean) || null;
  const placeAbove = box => {
    const top = document.querySelector(TOP_ROW);
    if (!top) return false;
    if (box.nextElementSibling !== top) top.before(box);
    return true;
  };

  async function showChips(results, key) {
    clearUI();
    // Wait for YouTube to build that row before showing anything, so the chip appears once in
    // its final place instead of jumping there from a fallback position.
    const top = await waitFor(() => document.querySelector(TOP_ROW), key);
    if (pageKey() !== key) return;
    const box = el('div', { class: 'detour-chips' });
    for (const r of results) {
      box.append(el('a', {
        class: `detour-chip detour-${r.platform}`,
        href: r.url, target: '_blank', rel: 'noopener',
        title: chipTooltip(r),
        onclick: pause,
      },
      el('span', { class: 'detour-dot', 'aria-hidden': 'true' }),
      chipLabel(r),
      svg(ICON_OUT, 14)));
    }
    if (top) { box.classList.add('detour-above'); placeAbove(box); }
    else { box.classList.add('detour-floating'); document.body.append(box); } // row never appeared
    ui.push(box);

    // YouTube sometimes re-renders the metadata shortly after load, dropping our node: put it back.
    if (top) {
      let tries = 0;
      const keep = setInterval(() => {
        if (pageKey() !== key || !ui.includes(box) || ++tries > 30) return clearInterval(keep);
        if (!box.isConnected) placeAbove(box);
      }, 500);
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
    if (shown.length) showChips(shown, key);
  }

  // ------------------------------------------------------------ channel page: banner

  async function dismissed() {
    return (await chrome.storage.local.get({ dismissedChannels: [] })).dismissedChannels;
  }

  const CHANNEL_ACTIONS = 'yt-page-header-view-model yt-flexible-actions-view-model, #page-header yt-flexible-actions-view-model';
  const CHANNEL_HEADER = ['yt-page-header-view-model', '#page-header'];

  async function showBanners(results, info, key) {
    clearUI();
    // Place it inside the channel header, right under the Subscribe button row: that part of
    // the page is in normal flow, so the tabs move down. (The tab bar itself is a fixed-height
    // strip and must not be used.) Wait for that row to exist so the banner doesn't jump.
    // Fallbacks: end of the header, then floating at the bottom.
    const actions = await waitFor(() => document.querySelector(CHANNEL_ACTIONS), key, 8000);
    if (pageKey() !== key) return;
    const header = actions ? null : firstMatch(CHANNEL_HEADER);
    const place = node => {
      if (actions) actions.after(node);
      else if (header) header.append(node);
      else { node.classList.add('detour-floating'); document.body.append(node); }
    };
    let last = null;
    for (const r of results) {
      const id = `${r.platform}:${info.channelId || info.author}`;
      const banner = el('div', { class: `detour-banner detour-${r.platform}`, role: 'region', 'aria-label': `${NAMES[r.platform]} link` },
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
      if (last) last.after(banner); // keep multiple banners in order
      else place(banner);
      last = banner;
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
    if (shown.length) showBanners(shown, info, key);
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
