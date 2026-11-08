// Content script on YouTube: on each watch page, ask the background whether the
// video is on Nebula/Floatplane, then either auto-redirect or show a button.
(() => {
  const SKIP_KEY = 'altRedirectSkip';
  let currentVideo = null;
  let ui = null;
  let countdownTimer = null;

  const videoIdFromUrl = () => {
    const u = new URL(location.href);
    return u.pathname === '/watch' ? u.searchParams.get('v') : null;
  };

  const skipped = () => { try { return JSON.parse(sessionStorage.getItem(SKIP_KEY) || '[]'); } catch { return []; } };
  const markSkipped = id => { try { sessionStorage.setItem(SKIP_KEY, JSON.stringify([...skipped(), id].slice(-200))); } catch { /* ignore */ } };

  // Ask page.js (main world) for the player data, retrying until the player has the new video.
  function askPage(videoId) {
    return new Promise(resolve => {
      const nonce = Math.random().toString(36).slice(2);
      const onMsg = ev => {
        if (ev.source !== window || ev.data?.source !== 'alt-redirect-page' || ev.data.nonce !== nonce) return;
        window.removeEventListener('message', onMsg);
        resolve(ev.data.info);
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'alt-redirect-cs', type: 'getInfo', videoId, nonce }, '*');
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve(null); }, 500);
    });
  }

  async function getInfo(videoId) {
    for (let i = 0; i < 30; i++) {
      if (videoIdFromUrl() !== videoId) return null; // navigated away
      const info = await askPage(videoId);
      if (info?.title) return info;
      await new Promise(r => setTimeout(r, 300));
    }
    // Fallback: scrape the DOM (no channel ID, so matching relies on the channel name).
    const title = document.querySelector('h1.ytd-watch-metadata, h1.title')?.textContent?.trim();
    const owner = document.querySelector('ytd-video-owner-renderer a[href^="/@"], ytd-channel-name a');
    if (!title) return null;
    return { videoId, title, author: owner?.textContent?.trim() || '', profileUrl: owner ? owner.href : '', channelId: '' };
  }

  const NAMES = { nebula: 'Nebula', floatplane: 'Floatplane' };

  function clearUI() {
    clearInterval(countdownTimer);
    ui?.remove();
    ui = null;
  }

  function el(tag, props = {}, ...children) {
    const e = Object.assign(document.createElement(tag), props);
    children.forEach(c => e.append(c));
    return e;
  }

  function showButtons(results) {
    clearUI();
    ui = el('div', { className: 'altr-wrap' });
    for (const r of results) {
      const label = r.kind === 'video' ? `Watch on ${NAMES[r.platform]}` : `${r.creator || 'Channel'} on ${NAMES[r.platform]}`;
      const a = el('a', {
        className: `altr-btn altr-${r.platform}`,
        href: r.url, target: '_blank', rel: 'noopener',
        title: r.kind === 'video' ? `Matched “${r.title}” (${Math.round(r.confidence * 100)}% confidence)` : 'This video wasn’t found, but the channel is there',
      }, label);
      a.addEventListener('click', () => window.postMessage({ source: 'alt-redirect-cs', type: 'pause' }, '*'));
      ui.append(a);
    }
    // Sit next to the channel / subscribe row under the video; float in the corner if it's not found.
    const anchor = document.querySelector('#owner.ytd-watch-metadata, ytd-video-owner-renderer')?.parentElement;
    if (anchor) {
      ui.classList.add('altr-inline');
      anchor.append(ui);
    } else {
      ui.append(el('button', { className: 'altr-close', title: 'Hide', onclick: clearUI }, '×'));
      document.body.append(ui);
    }
  }

  function autoRedirect(r, settings, videoId) {
    clearUI();
    window.postMessage({ source: 'alt-redirect-cs', type: 'pause' }, '*');
    markSkipped(videoId); // never redirect the same video twice in this tab (e.g. after Back)
    let left = 3;
    const go = () => {
      clearUI();
      if (settings.newTab) window.open(r.url, '_blank', 'noopener');
      else location.assign(r.url);
    };
    const msg = el('span', {}, `Opening on ${NAMES[r.platform]} in ${left}s…`);
    ui = el('div', { className: `altr-wrap altr-toast altr-${r.platform}` },
      msg,
      el('button', { className: 'altr-btn', onclick: go }, 'Go now'),
      el('button', { className: 'altr-btn altr-stay', onclick: () => { clearUI(); } }, 'Stay on YouTube'));
    document.body.append(ui);
    countdownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) go();
      else msg.textContent = `Opening on ${NAMES[r.platform]} in ${left}s…`;
    }, 1000);
  }

  async function onNavigate() {
    const videoId = videoIdFromUrl();
    if (videoId === currentVideo) return;
    currentVideo = videoId;
    clearUI();
    if (!videoId) return;

    const info = await getInfo(videoId);
    if (!info || videoIdFromUrl() !== videoId) return;

    let resp;
    try { resp = await chrome.runtime.sendMessage({ type: 'lookup', info }); }
    catch (e) { console.warn('[alt-redirect]', e); return; }
    if (!resp || resp.error || videoIdFromUrl() !== videoId) {
      if (resp?.error) console.warn('[alt-redirect]', resp.error);
      return;
    }
    const { results, settings } = resp;
    if (!results.length) return;

    const best = results[0];
    const canRedirect = settings.autoRedirect && best.subscribed && best.kind === 'video' &&
      best.confidence >= settings.minConfidence && !skipped().includes(videoId);
    if (canRedirect) autoRedirect(best, settings, videoId);
    else {
      // Subscribed matches always get a button; others only if the user wants them.
      const shown = results.filter(r => r.subscribed || settings.showButton);
      if (shown.length) showButtons(shown);
    }
  }

  document.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('popstate', onNavigate);
  setInterval(onNavigate, 1000); // catch-all for mobile site / missed events
  onNavigate();
})();
